import type { z } from "zod";
import type { TurnEvent } from "../events/events";
import type { OpenAITool, ToolRunContext } from "../conversation/turn";

export type { OpenAITool };

export interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  parameters: TArgs;
  execute: (args: z.infer<TArgs>, ctx?: ToolRunContext) => AsyncGenerator<TurnEvent, string>;
  summarize?: (args: z.infer<TArgs>) => string;
}

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
