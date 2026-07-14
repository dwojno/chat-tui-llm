import type { ApprovalOutcome, ApprovalRisk } from "../humanLayer/approval";

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label?: string; detail?: string; fork?: string }
  | { type: "status"; text: string; fork?: string }
  | {
      type: "approval_request";
      toolName: string;
      label?: string;
      detail?: string;
      reason?: string;
      risk?: ApprovalRisk;
    }
  | { type: "approval_resolved"; toolName: string; outcome: ApprovalOutcome };
