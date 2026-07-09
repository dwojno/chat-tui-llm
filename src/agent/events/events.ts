import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label?: string; detail?: string; fork?: string }
  | { type: "status"; text: string; fork?: string }
  | { type: "answer"; content: string }
  | { type: "message"; item: ResponseInputItem }
  | { type: "usage"; kind: "response" | "summarizer"; usage: ResponseUsage | undefined };
