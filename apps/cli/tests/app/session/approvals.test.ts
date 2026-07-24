import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TurnEvent } from "@/agent/events/events";
import type { ApprovalDecision, ApprovalRequest } from "@/agent/humanLayer/approval";
import type { ToolDefinition } from "@/agent/tools/types";
import type { ToolRunContext } from "@/agent/conversation/turn";
import { DEFAULT_TURN_OPTIONS } from "@/agent/conversation/options";
import { createMemoryStore, createMockOpenAI } from "@tests/helpers/mock-openai";
import { testSession } from "@tests/helpers/agent";

function gatedTool(): ToolDefinition<z.ZodType> {
  const parameters = z.object({ target: z.string() });
  const tool: ToolDefinition<typeof parameters> = {
    name: "delete_thing",
    label: "Deleting",
    description: "destructive test tool",
    parameters,
    async execute() {
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
    const { session } = await testSession(mock.client, store, { tools: [gatedTool()] });

    const confirm = vi.fn(
      async (_r: ApprovalRequest): Promise<ApprovalDecision> => ({ outcome: "always" }),
    );
    session.setApprovalHandler(confirm);

    await session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false });

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
      async execute(_args: { target: string }, ctx?: ToolRunContext) {
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
    const { session } = await testSession(mock.client, store, { tools: [tool] });

    const confirm = vi.fn(
      async (_r: ApprovalRequest): Promise<ApprovalDecision> => ({ outcome: "always" }),
    );
    session.setApprovalHandler(confirm);

    await session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false });

    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("does not gate when approvals are disabled", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      { calls: [{ name: "delete_thing", arguments: { target: "a" } }] },
      { text: "done" },
    ]);
    const { session, bus } = await testSession(mock.client, store, { tools: [gatedTool()] });
    const events: TurnEvent[] = [];
    bus.subscribe((e) => events.push(e));

    await session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false });

    expect(session.hasApprovalHandler).toBe(false);
    expect(events.some((e) => e.type === "approval_request")).toBe(false);
  });
});
