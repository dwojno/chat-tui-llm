import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { TurnEvent } from "../events/events";
import type { ForkProfiles } from "../tools/types";
import type { ApprovalGate } from "../tools/approval";
import type { ClarificationGate } from "../tools/clarification";
import type { TurnOptions } from "./options";

export type TurnContext = {
  memories: readonly string[];
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
};

export type OpenAITool = {
  type: "function";
  name: string;
  label: string;
  parameters: Record<string, unknown>;
  strict: boolean;
  description: string;
};

export type TurnProfile = {
  instructions: string;
  tools: OpenAITool[];
  cacheKey: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
};

export type RunTurn = (
  messages: readonly ResponseInputItem[],
  options: TurnOptions,
  context: TurnContext,
  profile: TurnProfile,
) => AsyncGenerator<TurnEvent, void>;

export interface ToolRunContext {
  openai: OpenAI;
  context: TurnContext;
  messages: readonly ResponseInputItem[];
  runTurn: RunTurn;
  forkProfiles: ForkProfiles;
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}
