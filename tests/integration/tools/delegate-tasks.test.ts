import { describe, expect, it } from "vitest";
import { AgentService } from "../../../src/agent/agent";
import { toOpenAITool } from "../../../src/agent/tools/types";
import type { ToolRunContext } from "../../../src/agent/conversation/turn";
import type { TurnEvent } from "../../../src/agent/events/events";
import { forkToolSchemas } from "../../../src/integration/tools";
import {
  DELEGATE_TASKS_NAME,
  delegateTasksTool,
  parseDelegateTasksArgs,
} from "../../../src/integration/tools/delegate-tasks";
import type { ForkResult } from "../../../src/agent/tools/utils/fork-result";
import { createMockOpenAI, type MockHandoff, type MockTurn } from "../../helpers/mock-openai";

function makeCtx(turns: MockTurn[], handoffs: MockHandoff[]) {
  const mock = createMockOpenAI(turns, handoffs);
  const agent = new AgentService(mock.client, { forkTools: [] });
  const ctx: ToolRunContext = {
    openai: mock.client,
    context: { memories: [] },
    messages: [],
    runTurn: (msgs, options, context, profile) => agent.run(msgs, options, context, profile),
    forkTools: forkToolSchemas,
  };
  return { ctx, mock };
}

async function drain(gen: AsyncGenerator<TurnEvent, string>) {
  const events: TurnEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

describe("parseDelegateTasksArgs", () => {
  const task = { title: "A", task: "do a", relevantMemoryKeys: null };

  it("parses a valid tasks array", () => {
    const args = parseDelegateTasksArgs(JSON.stringify({ tasks: [task] }));
    expect(args.tasks).toHaveLength(1);
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
          { title: "A", task: "a", relevantMemoryKeys: null },
          { title: "B", task: "b", relevantMemoryKeys: null },
        ],
      }),
    ).toBe("A, B");
  });

  it("fans out tasks in parallel and returns one ForkResult per task", async () => {
    const { ctx, mock } = makeCtx(
      [{ text: "child A done" }, { text: "child B done" }],
      [{ summary: "digest A" }, { summary: "digest B" }],
    );

    const { result } = await drain(
      delegateTasksTool.execute(
        {
          tasks: [
            { title: "A", task: "do a", relevantMemoryKeys: null },
            { title: "B", task: "do b", relevantMemoryKeys: null },
          ],
        },
        ctx,
      ),
    );

    const parsed = JSON.parse(result) as ForkResult[];
    expect(parsed).toHaveLength(2);
    // Both forks compressed; digest→task pairing is scheduling-dependent, so assert the set.
    expect(parsed.map((r) => r.summary).toSorted()).toEqual(["digest A", "digest B"]);
    expect(mock.calls.handoff).toHaveLength(2);
  });
});
