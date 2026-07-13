import type { z } from "zod";
import type { ToolDefinition } from "./types";

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalOutcome = "approve" | "reject" | "always";

export interface ApprovalNeed {
  required: boolean;
  reason?: string | undefined;
  risk?: ApprovalRisk | undefined;
}

export interface ApprovalRequest {
  toolName: string;
  label?: string | undefined;
  detail?: string | undefined;
  reason?: string | undefined;
  risk?: ApprovalRisk | undefined;
  allowAlways?: boolean | undefined;
}

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  note?: string | undefined;
}

export type ApprovalGate = (request: ApprovalRequest) => Promise<ApprovalDecision>;

export const APPROVAL_DENIED_OUTPUT =
  "The user declined to approve this action. Do not retry it; consider an " +
  "alternative approach or explain that you cannot proceed.";

export function evaluateApproval<TArgs extends z.ZodType>(
  tool: ToolDefinition<TArgs>,
  args: z.infer<TArgs>,
): ApprovalNeed {
  const hook = tool.approvalPolicy?.(args);
  const hookNeed: ApprovalNeed | undefined =
    hook === undefined ? undefined : typeof hook === "boolean" ? { required: hook } : hook;

  if (hookNeed?.required) {
    return { required: true, reason: hookNeed.reason, risk: hookNeed.risk };
  }
  if (tool.requiresApproval) {
    return { required: true };
  }
  return { required: false };
}
