import { describe, expect, it } from "vitest";
import {
  buildMessage,
  deriveControl,
  deriveScratchpad,
  eventToPrompt,
  threadToPrompt,
} from "@/app/runner/thread/reducer";
import type { AgentEvent } from "@/app/runner/thread/events";

const contentOf = (msg: ReturnType<typeof buildMessage>): string =>
  String((msg[0] as { content: string }).content);

describe("eventToPrompt", () => {
  it("wraps each event in a tag named for its type", () => {
    expect(eventToPrompt({ type: "user_message", content: "hi" })).toBe(
      "<user_message>\nhi\n</user_message>",
    );
  });
});

describe("threadToPrompt", () => {
  it("prunes an error once the same tool later succeeds, keeping the success", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "1", name: "weather", args: {} },
      { type: "error", id: "1", name: "weather", message: "network down" },
      { type: "tool_call", id: "2", name: "weather", args: {} },
      { type: "tool_result", id: "2", name: "weather", output: "sunny" },
    ];
    const rendered = threadToPrompt(events);
    expect(rendered).not.toContain("network down");
    expect(rendered).toContain("sunny");
  });

  it("keeps an unresolved error in the rendered thread", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "1", name: "weather", args: {} },
      { type: "error", id: "1", name: "weather", message: "still failing" },
    ];
    expect(threadToPrompt(events)).toContain("still failing");
  });

  it("prunes every same-tool error once that tool later succeeds", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "weather", message: "fail A" },
      { type: "error", id: "2", name: "weather", message: "fail B" },
      { type: "tool_result", id: "3", name: "weather", output: "sunny" },
    ];
    const rendered = threadToPrompt(events);
    expect(rendered).not.toContain("fail A");
    expect(rendered).not.toContain("fail B");
  });

  it("keeps an error when only a different tool succeeds", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "search", message: "boom" },
      { type: "tool_result", id: "2", name: "weather", output: "sunny" },
    ];
    expect(threadToPrompt(events)).toContain("boom");
  });

  it("renders a tool call as a named intent block and its result as {name}_result", () => {
    const events: AgentEvent[] = [
      { type: "tool_call", id: "1", name: "get_weather_data", args: { city: "Paris" } },
      { type: "tool_result", id: "1", name: "get_weather_data", output: "sunny" },
    ];
    const rendered = threadToPrompt(events);
    expect(rendered).toContain("<get_weather_data>");
    expect(rendered).toContain('intent: "get_weather_data"');
    expect(rendered).toContain("<get_weather_data_result>");
  });

  it("omits approval bookkeeping events from the prompt", () => {
    const events: AgentEvent[] = [
      { type: "approval_request", id: "1", name: "delete_thing", reason: "risky" },
      { type: "approval_response", id: "1", outcome: "approve" },
    ];
    expect(threadToPrompt(events)).toBe("");
  });
});

describe("buildMessage", () => {
  it("packs the whole thread into a single user message", () => {
    const msg = buildMessage({ events: [{ type: "user_message", content: "hello" }] });
    expect(msg).toHaveLength(1);
    expect((msg[0] as { role: string }).role).toBe("user");
    expect(contentOf(msg)).toContain("<events>");
    expect(contentOf(msg)).toContain("<next_step>");
  });

  it("renders a summary event before the tail, with memories last and discretion rules", () => {
    const content = contentOf(
      buildMessage({
        events: [
          { type: "summary", content: "earlier we discussed tea" },
          { type: "user_message", content: "hello" },
        ],
        memories: ["likes tea"],
      }),
    );
    expect(content).toContain("<conversation_summary>");
    expect(content.indexOf("<conversation_summary>")).toBeLessThan(
      content.indexOf("<user_message>"),
    );
    expect(content.indexOf("<events>")).toBeLessThan(content.indexOf("<user_known_memories>"));
    expect(content).toContain("M1: likes tea");
    expect(content).toContain("never volunteer them");
  });

  it("omits summary, memory, and scratchpad blocks when absent", () => {
    const content = contentOf(buildMessage({ events: [{ type: "user_message", content: "hi" }] }));
    expect(content).not.toContain("<conversation_summary>");
    expect(content).not.toContain("<user_known_memories>");
    expect(content).not.toContain("<scratchpad>");
  });

  it("renders the folded scratchpad after events and before next_step", () => {
    const content = contentOf(
      buildMessage({
        events: [
          { type: "user_message", content: "plan it" },
          { type: "scratchpad", ops: [{ section: "todo", content: "1. do it" }] },
        ],
      }),
    );
    expect(content).toContain("<scratchpad>");
    expect(content).toContain("<todo>\n1. do it\n</todo>");
    expect(content.indexOf("<events>")).toBeLessThan(content.indexOf("<scratchpad>"));
    expect(content.indexOf("<scratchpad>")).toBeLessThan(content.indexOf("<next_step>"));
  });
});

describe("deriveScratchpad", () => {
  it("folds sections last-write-wins and drops a cleared one, keeping order", () => {
    const events: AgentEvent[] = [
      {
        type: "scratchpad",
        ops: [
          { section: "todo", content: "a" },
          { section: "plan", content: "p" },
        ],
      },
      { type: "scratchpad", ops: [{ section: "todo", content: "b" }] },
      { type: "scratchpad", ops: [{ section: "plan", content: null }] },
    ];
    expect(deriveScratchpad(events)).toEqual([{ section: "todo", content: "b" }]);
  });

  it("keeps scratchpad ops out of the rendered transcript", () => {
    expect(
      threadToPrompt([{ type: "scratchpad", ops: [{ section: "todo", content: "secret" }] }]),
    ).toBe("");
  });
});

describe("deriveControl", () => {
  it("counts the trailing run of errors", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "t", message: "a" },
      { type: "error", id: "2", name: "t", message: "b" },
    ];
    expect(deriveControl(events).consecutiveErrors).toBe(2);
  });

  it("resets on a successful tool result", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "t", message: "a" },
      { type: "tool_result", id: "2", name: "t", output: "ok" },
      { type: "error", id: "3", name: "t", message: "b" },
    ];
    expect(deriveControl(events).consecutiveErrors).toBe(1);
  });

  it("resets on a new user message", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "t", message: "a" },
      { type: "user_message", content: "try again" },
    ];
    expect(deriveControl(events).consecutiveErrors).toBe(0);
  });

  it("resets on a human response (escalation answered)", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "t", message: "a" },
      { type: "human_response", content: "try the other tool" },
      { type: "error", id: "2", name: "t", message: "b" },
    ];
    expect(deriveControl(events).consecutiveErrors).toBe(1);
  });

  it("does not reset on a clarification_request", () => {
    const events: AgentEvent[] = [
      { type: "error", id: "1", name: "t", message: "a" },
      { type: "clarification_request", question: "?" },
      { type: "error", id: "2", name: "t", message: "b" },
    ];
    expect(deriveControl(events).consecutiveErrors).toBe(2);
  });

  it("lets a later success in the same round mask an earlier error", () => {
    const masked: AgentEvent[] = [
      { type: "error", id: "1", name: "a", message: "x" },
      { type: "tool_result", id: "2", name: "b", output: "ok" },
    ];
    expect(deriveControl(masked).consecutiveErrors).toBe(0);

    const trailing: AgentEvent[] = [
      { type: "tool_result", id: "1", name: "a", output: "ok" },
      { type: "error", id: "2", name: "b", message: "x" },
    ];
    expect(deriveControl(trailing).consecutiveErrors).toBe(1);
  });
});
