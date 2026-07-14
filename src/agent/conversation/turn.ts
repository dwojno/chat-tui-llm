import type { OpenAI } from "openai";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { EventBus } from "../events/bus";
import type { ForkProfiles } from "../tools/types";
import type { ApprovalGate } from "../humanLayer/approval";
import type { ClarificationGate } from "../humanLayer/clarification";
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

export type TurnResult = {
  answer: string;
  items: ResponseInputItem[];
  usage: ResponseUsage | undefined;
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
  openai: OpenAI;
  context: TurnContext;
  messages: readonly ResponseInputItem[];
  runTurn: RunTurn;
  forkProfiles: ForkProfiles;
  bus: EventBus;
  recordUsage: (usage: ResponseUsage | undefined) => void;
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}
