import { describe, expect, it } from "vitest";
import assert from "node:assert";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { Agent, DEFAULT_TURN_OPTIONS, EventBus, type Model, type ModelRequest } from "@chat/agent";

const message: ResponseInputItem[] = [{ role: "user", content: "email me at jane@example.com" }];

function createAgent(redact?: (text: string) => string): {
  agent: Agent;
  calls: ModelRequest[];
} {
  const calls: ModelRequest[] = [];
  const model: Model = {
    complete: async (request) => {
      calls.push(request);
      return {
        outputText: "ok",
        outputParsed: null,
        output: [],
        status: "completed",
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      };
    },
  };
  return {
    agent: new Agent({
      model,
      temperature: 0.7,
      cacheKey: "chat-cli:test",
      instructions: "system",
      ...(redact ? { redact } : {}),
    }),
    calls,
  };
}

function inputOf(request: ModelRequest | undefined): string {
  assert(request !== undefined);
  return JSON.stringify(request.input);
}

const redactPII = (text: string): string =>
  text
    .replaceAll(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replaceAll(/\b\d{3}-\d{3}-\d{4}\b/g, "[REDACTED_PHONE]");

describe("Agent model-input redaction", () => {
  it("scrubs PII from the input sent to the model when a redactor is injected", async () => {
    const { agent, calls } = createAgent(redactPII);

    await agent.step({ messages: message, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    const sent = inputOf(calls[0]);
    expect(sent).toContain("[REDACTED_EMAIL]");
    expect(sent).not.toContain("jane@example.com");
  });

  it("redacts text fields but never corrupts structural ids the model must echo back", async () => {
    const items = [
      {
        type: "reasoning",
        id: "rs_1234567890abcdef",
        summary: [],
        encrypted_content: "enc-9998887777-blob",
      },
      {
        type: "function_call",
        id: "fc_5551234567",
        call_id: "call_5551234567",
        name: "get_weather_data",
        arguments: JSON.stringify({ note: "reach me at 555-123-4567" }),
      },
      { role: "user", content: "email me at jane@example.com" },
    ] as unknown as ResponseInputItem[];

    const { agent, calls } = createAgent(redactPII);

    await agent.step({ messages: items, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    const sent = inputOf(calls[0]);
    // Structural fields (ids, call_id, name, encrypted reasoning) must round-trip intact —
    // corrupting them makes the next turn fail with a 400 "Invalid input[n].id".
    expect(sent).toContain("rs_1234567890abcdef");
    expect(sent).toContain("fc_5551234567");
    expect(sent).toContain("call_5551234567");
    expect(sent).toContain("get_weather_data");
    expect(sent).toContain("enc-9998887777-blob");
    // ...while genuine PII in text-bearing fields is still scrubbed.
    expect(sent).toContain("[REDACTED_EMAIL]");
    expect(sent).not.toContain("jane@example.com");
    expect(sent).not.toContain("555-123-4567");
  });

  it("leaves the input untouched when no redactor is injected", async () => {
    const { agent, calls } = createAgent();

    await agent.step({ messages: message, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    expect(inputOf(calls[0])).toContain("jane@example.com");
  });
});
