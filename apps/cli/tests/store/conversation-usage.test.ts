import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/app/runner/thread/events";
import { buildMessage } from "@/app/runner/thread/reducer";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { estimateTokens } from "@/app/tokens";
import { usageFromItems, usageFromRecords } from "@/store/conversation/helpers";

type StoredItem = Parameters<typeof usageFromItems>[0][number];

const SYS = estimateTokens(SYSTEM_INSTRUCTIONS);

const item = (payload: AgentEvent): StoredItem => ({
  kind: payload.type,
  turnIndex: 0,
  payload,
});

const promptCost = (events: AgentEvent[]): number => {
  const [message] = buildMessage({ events });
  if (!message || !("content" in message)) throw new Error("Expected packed user message");
  return (
    SYS +
    estimateTokens(
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    )
  );
};

describe("usageFromItems baseline", () => {
  it("charges the naive baseline once per model call, not once per turn", () => {
    const user: AgentEvent = { type: "user_message", content: "read the file" };
    const call: AgentEvent = { type: "tool_call", id: "c1", name: "read", args: {} };
    const result: AgentEvent = { type: "tool_result", id: "c1", name: "read", output: "data" };
    const answer: AgentEvent = { type: "assistant_answer", content: "done" };

    const totals = usageFromItems([item(user), item(call), item(result), item(answer)]);

    expect(totals.turns).toBe(1);
    expect(totals.baselineInput).toBe(promptCost([user]) + promptCost([user, call, result]));
    expect(totals.managedInput).toBe(totals.baselineInput);
  });

  it("grows cumulatively across turns (quadratic resend, not linear)", () => {
    const u1: AgentEvent = { type: "user_message", content: "first" };
    const a1: AgentEvent = { type: "assistant_answer", content: "one" };
    const u2: AgentEvent = { type: "user_message", content: "second" };
    const a2: AgentEvent = { type: "assistant_answer", content: "two" };

    const totals = usageFromItems([item(u1), item(a1), item(u2), item(a2)]);

    expect(totals.turns).toBe(2);
    expect(totals.baselineInput).toBe(promptCost([u1]) + promptCost([u1, a1, u2]));
    expect(totals.managedInput).toBe(totals.baselineInput);
  });

  it("counts every tool-loop model call in a single turn, not just the turn", () => {
    const user: AgentEvent = { type: "user_message", content: "do a lot of work" };
    const items: StoredItem[] = [item(user)];
    for (let i = 0; i < 6; i++) {
      const call: AgentEvent = { type: "tool_call", id: `c${i}`, name: "search", args: { i } };
      const result: AgentEvent = {
        type: "tool_result",
        id: `c${i}`,
        name: "search",
        output: "x".repeat(400),
      };
      items.push(item(call), item(result));
    }
    items.push(item({ type: "assistant_answer", content: "finished" }));

    const totals = usageFromItems(items);

    // 6 tool-call steps + 1 final answer = 7 model calls, each charged the system prompt.
    expect(totals.turns).toBe(1);
    expect(totals.baselineInput).toBeGreaterThanOrEqual(7 * SYS);
  });

  it("compares full history against summary-managed history", () => {
    const oldUser: AgentEvent = { type: "user_message", content: "x".repeat(2_000) };
    const oldAnswer: AgentEvent = { type: "assistant_answer", content: "y".repeat(2_000) };
    const summary: AgentEvent = { type: "summary", content: "short summary" };
    const user: AgentEvent = { type: "user_message", content: "hello" };
    const answer: AgentEvent = { type: "assistant_answer", content: "hi" };

    const totals = usageFromItems([
      item(oldUser),
      item(oldAnswer),
      item(summary),
      item(user),
      item(answer),
    ]);

    expect(totals.baselineInput).toBeGreaterThan(totals.managedInput);
  });

  it("attributes fork/handoff records to forkInput via usageFromRecords", () => {
    const user: AgentEvent = { type: "user_message", content: "research this" };
    const call: AgentEvent = {
      type: "tool_call",
      id: "d1",
      name: "delegate_task",
      args: {},
    };
    const result: AgentEvent = {
      type: "tool_result",
      id: "d1",
      name: "delegate_task",
      output: '{"summary":"ok"}',
    };
    const answer: AgentEvent = { type: "assistant_answer", content: "done" };

    const totals = usageFromRecords(
      [
        {
          kind: "fork",
          model: "gpt-4.1-nano",
          inputTokens: 26_932,
          cachedInputTokens: 0,
          outputTokens: 100,
        },
        {
          kind: "parent",
          model: "gpt-test",
          inputTokens: 9_546,
          cachedInputTokens: 0,
          outputTokens: 50,
        },
      ],
      [item(user), item(call), item(result), item(answer)],
    );

    expect(totals.actualInput).toBe(36_478);
    expect(totals.forkInput).toBe(26_932);
    expect(totals.baselineInput).toBe(promptCost([user]) + promptCost([user, call, result]));
    expect(totals.managedInput).toBe(totals.baselineInput);
  });
});
