import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { TurnEvent } from "../events/events";
import type { TurnOptions } from "./options";

export type TurnContext = {
  memories: readonly string[];
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
  /** Tool schemas a delegated sub-agent may use (e.g. for `delegate_task`). */
  forkTools: OpenAITool[];
}
