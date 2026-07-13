import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { ApprovalOutcome, ApprovalRisk } from "../tools/approval";

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label?: string; detail?: string; fork?: string }
  | { type: "status"; text: string; fork?: string }
  | { type: "answer"; content: string }
  | { type: "message"; item: ResponseInputItem }
  | { type: "usage"; kind: "response" | "summarizer"; usage: ResponseUsage | undefined }
  | {
      type: "approval_request";
      toolName: string;
      label?: string;
      detail?: string;
      reason?: string;
      risk?: ApprovalRisk;
    }
  | { type: "approval_resolved"; toolName: string; outcome: ApprovalOutcome };
