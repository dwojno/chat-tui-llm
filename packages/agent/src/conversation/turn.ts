import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { Model } from "../model";
import type { EventBus } from "../events/bus";
import type { ForkProfiles, OpenAITool } from "../tools/types";
import type { ApprovalGate } from "../humanLayer/approval";
import type { ClarificationGate } from "../humanLayer/clarification";
import type { TurnOptions } from "./options";

export type TurnContext = {
  memories: readonly string[];
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
};

export type TurnProfile = {
  instructions: string;
  tools: OpenAITool[];
  cacheKey: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
};

export type TurnResult = {
  answer: string;
  items: ResponseInputItem[];
};

export type RunTurnArgs = {
  messages: readonly ResponseInputItem[];
  options: TurnOptions;
  context: TurnContext;
  profile: TurnProfile;
  bus: EventBus;
};

export type RunTurn = (args: RunTurnArgs) => Promise<TurnResult>;

export interface ToolRunContext {
  model: Model;
  context: TurnContext;
  runTurn: RunTurn;
  forkProfiles: ForkProfiles;
  bus: EventBus;
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}
