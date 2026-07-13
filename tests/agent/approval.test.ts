import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { AgentService } from "../../src/agent/agent";
import { APPROVAL_DENIED_OUTPUT } from "../../src/agent/tools/approval";
import type { ApprovalDecision, ApprovalRequest } from "../../src/agent/tools/approval";
import type { ToolDefinition } from "../../src/agent/tools/types";
import type { TurnContext } from "../../src/agent/conversation/turn";
import type { TurnEvent } from "../../src/agent/events/events";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { createMockOpenAI, type MockTurn } from "../helpers/mock-openai";
import { collect } from "../../src/utils/async-gen";

const userMessage = (content: string): ResponseInputItem => ({ role: "user", content });

type Item = Record<string, unknown>;

const toolOutputs = (events: TurnEvent[]): string[] =>
  events.flatMap((e) =>
    e.type === "message" && (e.item as unknown as Item).type === "function_call_output"
      ? [(e.item as unknown as Item).output as string]
      : [],
  );

function gatedTool(onRun: () => void): ToolDefinition<z.ZodType> {
  const parameters = z.object({ target: z.string() });
  const tool: ToolDefinition<typeof parameters> = {
    name: "delete_thing",
    label: "Deleting",
    description: "destructive test tool",
    parameters,
    async *execute() {
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
    async *execute() {
      onRun();
      return "SAFE_OK";
    },
  };
  return tool as ToolDefinition<z.ZodType>;
}

function makeService(turns: MockTurn[], tools: ToolDefinition<z.ZodType>[]) {
  const mock = createMockOpenAI(turns);
  return { service: new AgentService(mock.client, { tools }), mock };
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

describe("AgentService.run HITL gate", () => {
  it("runs a gated tool after approval", async () => {
    const onRun = vi.fn();
    const { service } = makeService(callThenAnswer, [gatedTool(onRun)]);
    const ctx: TurnContext = { memories: [], requestApproval: gate("approve") };

    const events = await collect(
      service.run([userMessage("delete db")], DEFAULT_TURN_OPTIONS, ctx),
    );

    expect(events.some((e) => e.type === "approval_request" && e.toolName === "delete_thing")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "approval_resolved" && e.outcome === "approve")).toBe(
      true,
    );
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(events)).toEqual(["DID_DELETE"]);
    expect(events.at(-1)).toEqual({ type: "answer", content: "done" });
  });

  it("skips a rejected tool, feeds the denial back, and keeps going", async () => {
    const onRun = vi.fn();
    const { service } = makeService(callThenAnswer, [gatedTool(onRun)]);
    const ctx: TurnContext = { memories: [], requestApproval: gate("reject") };

    const events = await collect(
      service.run([userMessage("delete db")], DEFAULT_TURN_OPTIONS, ctx),
    );

    expect(events.some((e) => e.type === "approval_resolved" && e.outcome === "reject")).toBe(true);
    expect(onRun).not.toHaveBeenCalled();
    expect(toolOutputs(events)).toEqual([APPROVAL_DENIED_OUTPUT]);
    expect(events.at(-1)).toEqual({ type: "answer", content: "done" });
  });

  it("runs unattended (no prompt) when no gate is injected", async () => {
    const onRun = vi.fn();
    const { service } = makeService(callThenAnswer, [gatedTool(onRun)]);

    const events = await collect(
      service.run([userMessage("delete db")], DEFAULT_TURN_OPTIONS, { memories: [] }),
    );

    expect(events.some((e) => e.type === "approval_request")).toBe(false);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(events)).toEqual(["DID_DELETE"]);
  });

  it("gates only flagged calls, leaving unflagged ones to run in order", async () => {
    const gatedRun = vi.fn();
    const safeRun = vi.fn();
    const { service } = makeService(
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
    const ctx: TurnContext = {
      memories: [],
      requestApproval: gate("reject", (r) => seen.push(r)),
    };

    const events = await collect(service.run([userMessage("go")], DEFAULT_TURN_OPTIONS, ctx));

    expect(seen.map((r) => r.toolName)).toEqual(["delete_thing"]);
    expect(gatedRun).not.toHaveBeenCalled();
    expect(safeRun).toHaveBeenCalledTimes(1);
    expect(toolOutputs(events)).toEqual([APPROVAL_DENIED_OUTPUT, "SAFE_OK"]);
  });
});
