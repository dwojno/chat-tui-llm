import { z } from "zod";
import type { ToolRunContext } from "@/agent/conversation/turn";
import type { ToolDefinition } from "@/agent/tools/types";

export const REQUEST_APPROVAL_NAME = "request_approval" as const;

const parameters = z.object({
  action: z.string().min(1).describe("The specific action you intend to take, in plain language."),
  reason: z
    .string()
    .min(1)
    .describe("Why you are unsure, or why this action needs a human decision before proceeding."),
});

export type RequestApprovalArgs = z.infer<typeof parameters>;

async function execute(
  { action, reason }: RequestApprovalArgs,
  ctx?: ToolRunContext,
): Promise<string> {
  if (!ctx?.requestApproval) {
    return "No human is available to approve right now; proceed using your best judgement.";
  }
  const decision = await ctx.requestApproval({
    toolName: REQUEST_APPROVAL_NAME,
    label: "Requesting approval",
    detail: action,
    reason,
    risk: "medium",
    allowAlways: false,
  });
  const note = decision.note ? ` Note: ${decision.note}` : "";
  return decision.outcome === "reject"
    ? `The user did NOT approve: "${action}". Do not proceed with it.${note}`
    : `The user approved: "${action}". You may proceed.${note}`;
}

export const requestApprovalTool: ToolDefinition<typeof parameters> = {
  name: REQUEST_APPROVAL_NAME,
  label: "Requesting approval",
  description:
    "Pause and ask the user to approve an action before you take it. Use this " +
    "when you are about to do something consequential or you are not confident " +
    "it is what the user wants. Provide the `action` you intend to take and the " +
    "`reason` you need confirmation. Returns the user's decision.",
  parameters,
  execute,
  summarize: ({ action }) => action,
};
