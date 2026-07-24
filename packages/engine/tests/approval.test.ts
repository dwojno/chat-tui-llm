import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Model } from "@chat/platform/model";
import { Agent } from "@chat/agent/agent";
import { EventBus } from "@chat/agent/events/bus";
import { APPROVAL_DENIED_OUTPUT } from "@chat/agent/humanLayer/approval";
import type { ApprovalDecision, ApprovalRequest } from "@chat/agent/humanLayer/approval";
import type { ToolDefinition } from "@chat/agent/tools/types";
import type { TurnContext } from "@chat/agent/conversation/turn";
import type { TurnEvent } from "@chat/agent/events/events";
import { DEFAULT_TURN_OPTIONS } from "@chat/agent/conversation/options";
import { runAgentLoop } from "@chat/engine";
import type { AgentEvent } from "@chat/agent";
import { createMockOpenAI, type MockTurn } from "./helpers/mock-openai";

const userMessage = (content: string): AgentEvent => ({ type: "user_message", content });

const toolOutputs = (events: AgentEvent[]): string[] =>
  events.flatMap((e) => (e.type === "tool_result" ? [e.output] : []));

function gatedTool(onRun: () => void): ToolDefinition<z.ZodType> {
  const parameters = z.object({ target: z.string() });
  const tool: ToolDefinition<typeof parameters> = {
    name: "delete_thing",
    label: "Deleting",
    description: "destructive test tool",
    parameters,
    execute: async () => {
      onRun();
      return "DID_DELETE";
    },
    summarize: ({ target }) => target,
    requiresApproval: true,
  };
  return tool as ToolDefinition<z.ZodType>;
}

function safeTool(onRun: () => void): ToolDefinition<z.ZodType> {
  const parameters = z.object({ q: z.string() });
  const tool: ToolDefinition<typeof parameters> = {
    name: "safe_thing",
    label: "Safe",
    description: "read-only test tool",
    parameters,
    execute: async () => {
      onRun();
      return "SAFE_OK";
    },
  };
  return tool as ToolDefinition<z.ZodType>;
}

function makeAgent(turns: MockTurn[], tools: ToolDefinition<z.ZodType>[]) {
  const mock = createMockOpenAI(turns);
  const agent = new Agent({
    model: Model.fromOpenAI(mock.client),
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: "system",
    tools,
  });
  return { agent, mock };
}

async function run(agent: Agent, seed: AgentEvent[], context: TurnContext) {
  const events: TurnEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => events.push(e));
  const result = await runAgentLoop({
    agent,
    events: seed,
    options: DEFAULT_TURN_OPTIONS,
    context,
    bus,
    maxToolSteps: 8,
    maxConsecutiveErrors: 3,
  });
  return { events, result };
}

const gate =
  (outcome: ApprovalDecision["outcome"], spy?: (r: ApprovalRequest) => void) =>
  async (request: ApprovalRequest): Promise<ApprovalDecision> => {
    spy?.(request);
    return { outcome };
  };

const callThenAnswer: MockTurn[] = [
  { calls: [{ name: "delete_thing", arguments: { target: "db" } }] },
  { text: "done" },
];

describe("runAgentLoop HITL gate", () => {
  it("runs a gated tool after approval", async () => {
    const onRun = vi.fn();
    const { agent } = makeAgent(callThenAnswer, [gatedTool(onRun)]);
    const ctx: TurnContext = { memories: [], requestApproval: gate("approve") };

    const { events, result } = await run(agent, [userMessage("delete db")], ctx);

    expect(events.some((e) => e.type === "approval_request" && e.toolName === "delete_thing")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "approval_resolved" && e.outcome === "approve")).toBe(
      true,
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(result.events)).toEqual(["DID_DELETE"]);
    expect(result.answer).toBe("done");
  });

  it("skips a rejected tool, feeds the denial back, and keeps going", async () => {
    const onRun = vi.fn();
    const { agent } = makeAgent(callThenAnswer, [gatedTool(onRun)]);
    const ctx: TurnContext = { memories: [], requestApproval: gate("reject") };

    const { events, result } = await run(agent, [userMessage("delete db")], ctx);

    expect(events.some((e) => e.type === "approval_resolved" && e.outcome === "reject")).toBe(true);
    expect(onRun).not.toHaveBeenCalled();
    expect(toolOutputs(result.events)).toEqual([APPROVAL_DENIED_OUTPUT]);
    expect(result.answer).toBe("done");
  });

  it("runs unattended (no prompt) when no gate is injected", async () => {
    const onRun = vi.fn();
    const { agent } = makeAgent(callThenAnswer, [gatedTool(onRun)]);

    const { events, result } = await run(agent, [userMessage("delete db")], { memories: [] });

    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(result.events)).toEqual(["DID_DELETE"]);
  });

  it("gates only flagged calls, leaving unflagged ones to run in order", async () => {
    const gatedRun = vi.fn();
    const safeRun = vi.fn();
    const { agent } = makeAgent(
      [
        {
          calls: [
            { name: "delete_thing", arguments: { target: "db" } },
            { name: "safe_thing", arguments: { q: "x" } },
          ],
        },
        { text: "done" },
      ],
      [gatedTool(gatedRun), safeTool(safeRun)],
    );
    const seen: ApprovalRequest[] = [];
    const ctx: TurnContext = { memories: [], requestApproval: gate("reject", (r) => seen.push(r)) };

    const { result } = await run(agent, [userMessage("go")], ctx);

    expect(seen.map((r) => r.toolName)).toEqual(["delete_thing"]);
    expect(gatedRun).not.toHaveBeenCalled();
    expect(safeRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(result.events)).toEqual([APPROVAL_DENIED_OUTPUT, "SAFE_OK"]);
  });
});
