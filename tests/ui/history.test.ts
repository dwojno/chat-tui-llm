import { describe, expect, it } from "vitest";
import assert from "node:assert";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { messagesFromTranscript } from "../../src/ui/history";

describe("messagesFromTranscript", () => {
  it("returns nothing for an empty transcript", () => {
    expect(messagesFromTranscript([])).toEqual([]);
  });

  it("maps user and assistant messages, extracting array content", () => {
    const items: ResponseInputItem[] = [
      { role: "user", content: "hi" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hello", annotations: [] }],
        status: "completed",
        id: "m1",
      } as unknown as ResponseInputItem,
    ];

    expect(messagesFromTranscript(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", steps: undefined },
    ]);
  });

  it("folds a turn's tool calls into the following assistant message's steps", () => {
    const items: ResponseInputItem[] = [
      { role: "user", content: "weather?" },
      {
        type: "function_call",
        call_id: "c1",
        name: "get_weather_data",
        arguments: "{}",
      } as unknown as ResponseInputItem,
      {
        type: "function_call_output",
        call_id: "c1",
        output: "sunny",
      } as unknown as ResponseInputItem,
      { role: "assistant", content: "It's sunny." },
    ];

    const messages = messagesFromTranscript(items);
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    assert(assistant !== undefined);
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("It's sunny.");
    expect(assistant.steps).toHaveLength(1);
  });
});
