import type { ModelUsage } from "@chat/agent";

export type { ModelOperation, ModelRequest, ModelResponse, ModelUsage } from "@chat/agent";

export type UsageKind = "parent" | "fork" | "handoff" | "summarizer";

export type UsageRecord = ModelUsage & {
  model: string;
  kind: UsageKind;
};
