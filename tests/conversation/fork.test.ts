import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/tools")>();
  return { ...actual, executeToolCall: vi.fn(async () => "SEARCH_RESULT") };
});

import type { TurnEvent } from "../../src/conversation/events";
import { runFork } from "../../src/conversation/fork";
import { createMockOpenAI, createRecordingScope } from "../helpers/mock-openai";

/** Drive the runFork generator, collecting its events and its return value. */
async function drainFork(gen: AsyncGenerator<TurnEvent, string>) {
  const events: TurnEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, digest: step.value };
}

describe("runFork", () => {
  it("streams the sub-agent tool activity tagged with the fork label, and returns the digest", async () => {
    const mock = createMockOpenAI(
      [
        { calls: [{ name: "web_search", arguments: { query: "SSR" } }] },
        { text: "child concluded X" },
      ],
      ["HANDOFF DIGEST"],
    );
    const { scope, state } = createRecordingScope({ summary: "parent ctx", facts: ["fact"] });

    const { events, digest } = await drainFork(
      runFork(mock.client, scope, "Research SSR internals", "Research SSR"),
    );

    // The child's web_search is surfaced, tagged with the short label.
    expect(events).toContainEqual({
      type: "tool",
      name: "web_search",
      detail: "SSR",
      fork: "Research SSR",
    });
    // The child never streams its answer up — only tool/status events.
    expect(events.some((e) => e.type === "delta" || e.type === "answer")).toBe(false);

    // Returns the compressed handoff, and rolls the summarizer cost to the parent.
    expect(digest).toBe("HANDOFF DIGEST");
    expect(state.summarizerUsage).toHaveLength(1);
    expect(mock.calls.create).toHaveLength(1); // the handoff compression
  });
});
