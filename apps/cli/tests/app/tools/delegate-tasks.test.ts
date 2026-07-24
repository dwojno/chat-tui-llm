import { describe, expect, it } from "vitest";
import { toOpenAITool, type ForkProfiles } from "@chat/agent/tools/types";
import type { ToolRunContext } from "@chat/agent/conversation/turn";
import { EventBus } from "@chat/agent/events/bus";
import { FORK_MODEL } from "@/app/config";
import { FORK_INSTRUCTIONS } from "@/app/tools/prompts/fork";
import {
  DELEGATE_TASKS_NAME,
  delegateTasksTool,
  parseDelegateTasksArgs,
} from "@/app/tools/delegation/delegate-tasks";
import type { ForkResult } from "@/app/tools/delegation/fork-result";
import { eventsToInputItems, inputItemsToEvents, runAgentLoop } from "@chat/engine";
import { Model } from "@chat/platform/model";
import { createMockOpenAI, type MockHandoff, type MockTurn } from "@tests/helpers/mock-openai";
import { testAgent } from "@tests/helpers/agent";

const forkProfiles: ForkProfiles = {
  general: { instructions: FORK_INSTRUCTIONS, tools: [], model: FORK_MODEL },
  rag_research: { instructions: FORK_INSTRUCTIONS, tools: [], model: FORK_MODEL },
};

function makeCtx(turns: MockTurn[], handoffs: MockHandoff[]) {
  const mock = createMockOpenAI(turns, handoffs);
  const agent = testAgent(mock.client, { forkProfiles });
  const ctx: ToolRunContext = {
    model: Model.fromOpenAI(mock.client),
    context: { memories: [] },
    runTurn: (args) =>
      runAgentLoop({
        agent,
        maxToolSteps: 8,
        maxConsecutiveErrors: 3,
        events: inputItemsToEvents(args.messages),
        options: args.options,
        context: args.context,
        bus: args.bus,
        ...(args.profile ? { profile: args.profile } : {}),
      }).then((r) => ({ answer: r.answer, items: eventsToInputItems(r.events) })),
    forkProfiles,
    bus: new EventBus(),
  };
  return { ctx, mock };
}

describe("parseDelegateTasksArgs", () => {
  const task = { title: "A", task: "do a", relevantMemoryKeys: null, profile: null };

  it("parses a valid tasks array", () => {
    const args = parseDelegateTasksArgs(JSON.stringify({ tasks: [task] }));
    expect(args.tasks).toHaveLength(1);
  });

  it("keeps a per-task fork profile", () => {
    const args = parseDelegateTasksArgs(
      JSON.stringify({ tasks: [{ ...task, profile: "rag_research" }] }),
    );
    expect(args.tasks[0]?.profile).toBe("rag_research");
  });

  it("rejects an empty tasks array", () => {
    expect(() => parseDelegateTasksArgs(JSON.stringify({ tasks: [] }))).toThrow();
  });

  it("rejects more than 6 tasks (hard cap)", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => ({ ...task, title: `T${i}` }));
    expect(() => parseDelegateTasksArgs(JSON.stringify({ tasks }))).toThrow();
  });
});

describe("delegateTasksTool", () => {
  it("produces a strict function-tool schema for the API", () => {
    const tool = toOpenAITool(delegateTasksTool);
    expect(tool).toMatchObject({ type: "function", name: DELEGATE_TASKS_NAME, strict: true });
  });

  it("summarizes to the joined task titles", () => {
    expect(
      delegateTasksTool.summarize?.({
        tasks: [
          { title: "A", task: "a", relevantMemoryKeys: null, profile: null },
          { title: "B", task: "b", relevantMemoryKeys: null, profile: null },
        ],
      }),
    ).toBe("A, B");
  });

  it("fans out tasks in parallel and returns one ForkResult per task", async () => {
    const { ctx, mock } = makeCtx(
      [{ text: "child A done" }, { text: "child B done" }],
      [{ summary: "digest A" }, { summary: "digest B" }],
    );

    const result = await delegateTasksTool.execute(
      {
        tasks: [
          { title: "A", task: "do a", relevantMemoryKeys: null, profile: null },
          { title: "B", task: "do b", relevantMemoryKeys: null, profile: null },
        ],
      },
      ctx,
    );

    const parsed = JSON.parse(result) as ForkResult[];
    expect(parsed).toHaveLength(2);
    // Both forks compressed; digest→task pairing is scheduling-dependent, so assert the set.
    expect(parsed.map((r) => r.summary).toSorted()).toEqual(["digest A", "digest B"]);
    expect(mock.calls.handoff).toHaveLength(2);
  });
});
