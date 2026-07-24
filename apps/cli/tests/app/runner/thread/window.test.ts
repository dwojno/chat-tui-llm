import { describe, expect, it } from "vitest";
import { countUserTurns, splitAtLastTurns } from "@/app/runner/thread/window";
import type { AgentEvent } from "@chat/agent";

const turn = (n: number): AgentEvent[] => [
  { type: "user_message", content: `q${n}` },
  { type: "assistant_answer", content: `a${n}` },
];

describe("countUserTurns", () => {
  it("counts only user_message events", () => {
    expect(countUserTurns([...turn(1), ...turn(2)])).toBe(2);
  });
});

describe("splitAtLastTurns", () => {
  it("keeps everything when under the limit", () => {
    const events = [...turn(1)];
    expect(splitAtLastTurns(events, 4)).toEqual({ evicted: [], kept: events });
  });

  it("evicts everything before the Nth-from-last user message", () => {
    const events = [...turn(1), ...turn(2), ...turn(3)];
    const { evicted, kept } = splitAtLastTurns(events, 1);
    expect(evicted).toEqual([...turn(1), ...turn(2)]);
    expect(kept).toEqual([...turn(3)]);
  });

  it("evicts everything when keepTurns is zero", () => {
    const events = [...turn(1), ...turn(2)];
    expect(splitAtLastTurns(events, 0)).toEqual({ evicted: events, kept: [] });
  });

  it("attaches tool events to their user turn", () => {
    const events: AgentEvent[] = [
      ...turn(1),
      { type: "user_message", content: "q2" },
      { type: "tool_call", id: "1", name: "weather", args: {} },
      { type: "tool_result", id: "1", name: "weather", output: "sunny" },
      { type: "assistant_answer", content: "a2" },
    ];
    const { kept } = splitAtLastTurns(events, 1);
    expect(kept[0]).toEqual({ type: "user_message", content: "q2" });
    expect(kept).toHaveLength(4);
  });
});
