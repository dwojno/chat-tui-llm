import { describe, expect, it } from "vitest";
import assert from "node:assert";
import { messagesFromTranscript } from "@/ui/history";
import type { AgentEvent } from "@/app/runner/thread/events";

describe("messagesFromTranscript", () => {
  it("returns nothing for an empty transcript", () => {
    expect(messagesFromTranscript([])).toEqual([]);
  });

  it("maps user and assistant events to bubbles", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "hi" },
      { type: "assistant_answer", content: "hello" },
    ];

    expect(messagesFromTranscript(events)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("folds a turn's tool calls into the following assistant message's steps", () => {
    const events: AgentEvent[] = [
      { type: "user_message", content: "weather?" },
      { type: "tool_call", id: "c1", name: "get_weather_data", args: {} },
      { type: "tool_result", id: "c1", name: "get_weather_data", output: "sunny" },
      { type: "assistant_answer", content: "It's sunny." },
    ];

    const messages = messagesFromTranscript(events);
    expect(messages).toHaveLength(2);
    const assistant = messages[1];
    assert(assistant !== undefined);
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("It's sunny.");
    expect(assistant.steps).toHaveLength(1);
  });
});
