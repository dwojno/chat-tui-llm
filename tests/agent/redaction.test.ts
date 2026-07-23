import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { Model } from "@/platform/model";
import { Agent } from "@/agent/agent";
import { EventBus } from "@/agent/events/bus";
import { DEFAULT_TURN_OPTIONS } from "@/agent/conversation/options";
import { redactPII } from "@/platform/utils/redact";
import { createMockOpenAI } from "@tests/helpers/mock-openai";

const message: ResponseInputItem[] = [{ role: "user", content: "email me at jane@example.com" }];

function inputOf(params: unknown): string {
  return JSON.stringify((params as { input: unknown }).input);
}

describe("Agent model-input redaction", () => {
  it("scrubs PII from the input sent to the model when a redactor is injected", async () => {
    const mock = createMockOpenAI([{ text: "ok" }]);
    const agent = new Agent({
      model: Model.fromOpenAI(mock.client),
      temperature: 0.7,
      cacheKey: "chat-cli:test",
      instructions: "system",
      redact: redactPII,
    });

    await agent.step({ messages: message, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    const sent = inputOf(mock.calls.stream[0]);
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

    const mock = createMockOpenAI([{ text: "ok" }]);
    const agent = new Agent({
      model: Model.fromOpenAI(mock.client),
      temperature: 0.7,
      cacheKey: "chat-cli:test",
      instructions: "system",
      redact: redactPII,
    });

    await agent.step({ messages: items, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    const sent = inputOf(mock.calls.stream[0]);
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
    const mock = createMockOpenAI([{ text: "ok" }]);
    const agent = new Agent({
      model: Model.fromOpenAI(mock.client),
      temperature: 0.7,
      cacheKey: "chat-cli:test",
      instructions: "system",
    });

    await agent.step({ messages: message, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    expect(inputOf(mock.calls.stream[0])).toContain("jane@example.com");
  });
});
