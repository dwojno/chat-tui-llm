import type { z } from "zod";
import type { TurnEvent } from "../events/events";
import type { OpenAITool, ToolRunContext } from "../conversation/turn";
import type { ApprovalNeed } from "./approval";

export type { OpenAITool };

export interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  parameters: TArgs;
  execute: (args: z.infer<TArgs>, ctx?: ToolRunContext) => AsyncGenerator<TurnEvent, string>;
  summarize?: (args: z.infer<TArgs>) => string;
  requiresApproval?: boolean;
  approvalPolicy?: (args: z.infer<TArgs>) => boolean | ApprovalNeed;
}

export interface ForkProfile {
  instructions: string;
  tools: ToolDefinition<z.ZodType>[];
  model: string;
}

export const FORK_PROFILE_NAMES = ["general", "rag_research"] as const;

export type ForkProfileName = (typeof FORK_PROFILE_NAMES)[number];

export type ForkProfiles = Record<ForkProfileName, ForkProfile>;

export function toOpenAITool<TArgs extends z.ZodType>(tool: ToolDefinition<TArgs>): OpenAITool {
  return {
    type: "function",
    name: tool.name,
    label: tool.label,
    parameters: tool.parameters.toJSONSchema() as Record<string, unknown>,
    strict: true,
    description: tool.description,
  };
}
