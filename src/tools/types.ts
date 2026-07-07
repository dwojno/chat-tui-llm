import type { z } from 'zod'

export interface ToolDefinition<TArgs extends z.ZodType> {
  name: string
  description: string
  parameters: TArgs
  execute: (args: z.infer<TArgs>) => Promise<string>
}

export function toOpenAITool<TArgs extends z.ZodType>(
  tool: ToolDefinition<TArgs>,
) {
  return {
    type: 'function' as const,
    name: tool.name,
    parameters: tool.parameters.toJSONSchema(),
    strict: true,
    description: tool.description,
  }
}
