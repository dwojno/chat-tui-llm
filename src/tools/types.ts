import type { z } from "zod";

export interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string;
  description: string;
  parameters: TArgs;
  execute: (args: z.infer<TArgs>) => Promise<string>;
  /**
   * A short, human-readable detail for this specific call (e.g. the search
   * query or city), shown after the static `label` in the thinking trace.
   */
  summarize?: (args: z.infer<TArgs>) => string;
}

export function toOpenAITool<TArgs extends z.ZodType>(tool: ToolDefinition<TArgs>) {
  return {
    type: "function" as const,
    name: tool.name,
    label: tool.label,
    parameters: tool.parameters.toJSONSchema(),
    strict: true,
    description: tool.description,
  };
}
