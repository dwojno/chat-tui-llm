import { describe, expect, it } from "vitest";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses.mjs";
import {
  eventsToInputItems,
  inputItemsToEvents,
  toolCallToEvent,
  TOOL_ERROR_PREFIX,
} from "@/app/runner/thread/convert";
import type { AgentEvent } from "@/app/runner/thread/events";

describe("toolCallToEvent", () => {
  it("maps a native call to a tool_call event with parsed args", () => {
    const call = {
      call_id: "c1",
      name: "weather",
      arguments: '{"city":"Berlin"}',
    } as ResponseFunctionToolCall;
    expect(toolCallToEvent(call)).toEqual({
      type: "tool_call",
      id: "c1",
      name: "weather",
      args: { city: "Berlin" },
    });
  });
});

describe("eventsToInputItems", () => {
  it("renders tool results and errors as function_call_output items", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "1", name: "weather", args: { city: "Berlin" } },
      { type: "tool_result", id: "1", name: "weather", output: "sunny" },
      { type: "error", id: "2", name: "search", message: "boom" },
    ];
    const items = eventsToInputItems(events);
    expect(items[0]).toMatchObject({ type: "function_call", call_id: "1", name: "weather" });
    expect(items[1]).toEqual({ type: "function_call_output", call_id: "1", output: "sunny" });
    expect(items[2]).toEqual({
      type: "function_call_output",
      call_id: "2",
      output: `${TOOL_ERROR_PREFIX}boom`,
    });
  });
});

describe("eventsToInputItems", () => {
  it("maps human/assistant/clarification events to role messages", () => {
    const events: AgentEvent[] = [
      { type: "human_response", content: "yes" },
      { type: "assistant_answer", content: "done" },
      { type: "clarification_request", question: "which?" },
    ];
    expect(eventsToInputItems(events)).toEqual([
      { role: "user", content: "yes" },
      { role: "assistant", content: "done" },
      { role: "assistant", content: "which?" },
    ]);
  });

  it("drops approval bookkeeping events", () => {
    const events: AgentEvent[] = [
      { type: "approval_request", id: "1", name: "delete", reason: "risky" },
      { type: "approval_response", id: "1", outcome: "reject" },
    ];
    expect(eventsToInputItems(events)).toEqual([]);
  });
});

describe("inputItemsToEvents", () => {
  it("maps a seed user message back to a user_message event", () => {
    expect(inputItemsToEvents([{ role: "user", content: "do the thing" }])).toEqual([
      { type: "user_message", content: "do the thing" },
    ]);
  });

  it("maps a function_call_output back to a tool_result with a lost name", () => {
    expect(
      inputItemsToEvents([{ type: "function_call_output", call_id: "c1", output: "sunny" }]),
    ).toEqual([{ type: "tool_result", id: "c1", name: "", output: "sunny" }]);
  });

  it("round-trips an error event lossily into a prefixed tool_result", () => {
    const error: AgentEvent[] = [{ type: "error", id: "c1", name: "weather", message: "boom" }];
    const items = eventsToInputItems(error);
    // Through the SDK boundary an error becomes a function_call_output, so the
    // reverse mapping yields a tool_result whose output keeps the "Error: " prefix.
    expect(inputItemsToEvents(items)).toEqual([
      { type: "tool_result", id: "c1", name: "", output: `${TOOL_ERROR_PREFIX}boom` },
    ]);
  });
});
