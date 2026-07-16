import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
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
      openai: mock.client,
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

  it("leaves the input untouched when no redactor is injected", async () => {
    const mock = createMockOpenAI([{ text: "ok" }]);
    const agent = new Agent({
      openai: mock.client,
      temperature: 0.7,
      cacheKey: "chat-cli:test",
      instructions: "system",
    });

    await agent.step({ messages: message, options: DEFAULT_TURN_OPTIONS, bus: new EventBus() });

    expect(inputOf(mock.calls.stream[0])).toContain("jane@example.com");
  });
});
