import type { z } from "zod";
import type { ToolRunContext } from "../conversation/turn";
import type { ApprovalNeed } from "../humanLayer/approval";

export type OpenAITool = {
  type: "function";
  name: string;
  label: string;
  parameters: Record<string, unknown>;
  strict: boolean;
  description: string;
};

export interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  parameters: TArgs;
  rawParameters?: Record<string, unknown>;
  strict?: boolean;
  execute: (args: z.infer<TArgs>, ctx?: ToolRunContext) => Promise<string>;
  summarize?: (args: z.infer<TArgs>) => string;
  requiresApproval?: boolean;
  approvalPolicy?: (args: z.infer<TArgs>) => boolean | ApprovalNeed;
}

export interface ForkProfile {
  instructions: string;
  tools: ToolDefinition<z.ZodType>[];
  model: string;
}

export type ForkProfiles = Record<string, ForkProfile>;

export function toOpenAITool<TArgs extends z.ZodType>(tool: ToolDefinition<TArgs>): OpenAITool {
  return {
    type: "function",
    name: tool.name,
    label: tool.label,
    parameters: tool.rawParameters ?? (tool.parameters.toJSONSchema() as Record<string, unknown>),
    strict: tool.strict ?? true,
    description: tool.description,
  };
}
