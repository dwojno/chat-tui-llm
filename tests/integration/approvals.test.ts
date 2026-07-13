import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentService } from "../../src/agent/agent";
import type { ApprovalDecision, ApprovalRequest } from "../../src/agent/tools/approval";
import type { ToolDefinition } from "../../src/agent/tools/types";
import type { ToolRunContext } from "../../src/agent/conversation/turn";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { Session } from "../../src/integration/session";
import { createMemoryStore, createMockOpenAI } from "../helpers/mock-openai";
import { collect } from "../../src/utils/async-gen";

function gatedTool(): ToolDefinition<z.ZodType> {
  const parameters = z.object({ target: z.string() });
  const tool: ToolDefinition<typeof parameters> = {
    name: "delete_thing",
    label: "Deleting",
    description: "destructive test tool",
    parameters,
    async *execute() {
      return "OK";
    },
    requiresApproval: true,
  };
  return tool as ToolDefinition<z.ZodType>;
}

describe("Session HITL approvals", () => {
  it("prompts once for a tool then caches an always-allow decision", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      {
        calls: [
          { name: "delete_thing", arguments: { target: "a" } },
          { name: "delete_thing", arguments: { target: "b" } },
        ],
      },
      { text: "done" },
    ]);
    const agent = new AgentService(mock.client, { tools: [gatedTool()] });
    const session = await Session.create(agent, mock.client, store, 4);

    const confirm = vi.fn(
      async (_r: ApprovalRequest): Promise<ApprovalDecision> => ({ outcome: "always" }),
    );
    session.setApprovalHandler(confirm);

    await collect(session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false }));

    expect(session.hasApprovalHandler).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("never caches an always-allow for a non-cacheable request", async () => {
    const params = z.object({ target: z.string() });
    const tool: ToolDefinition<typeof params> = {
      name: "ask_thing",
      label: "Asking",
      description: "escape-hatch test tool",
      parameters: params,
      async *execute(_args: { target: string }, ctx?: ToolRunContext) {
        await ctx?.requestApproval?.({ toolName: "ask_thing", allowAlways: false });
        return "OK";
      },
    } as unknown as ToolDefinition<typeof params>;

    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      {
        calls: [
          { name: "ask_thing", arguments: { target: "a" } },
          { name: "ask_thing", arguments: { target: "b" } },
        ],
      },
      { text: "done" },
    ]);
    const agent = new AgentService(mock.client, { tools: [tool] });
    const session = await Session.create(agent, mock.client, store, 4);

    const confirm = vi.fn(
      async (_r: ApprovalRequest): Promise<ApprovalDecision> => ({ outcome: "always" }),
    );
    session.setApprovalHandler(confirm);

    await collect(session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false }));

    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not gate when approvals are disabled", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      { calls: [{ name: "delete_thing", arguments: { target: "a" } }] },
      { text: "done" },
    ]);
    const agent = new AgentService(mock.client, { tools: [gatedTool()] });
    const session = await Session.create(agent, mock.client, store, 4);

    const events = await collect(session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false }));

    expect(session.hasApprovalHandler).toBe(false);
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
  });
});
