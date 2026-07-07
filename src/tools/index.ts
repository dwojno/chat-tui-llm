import { weatherTool } from './weather'
import { toOpenAITool, type ToolDefinition } from './types'
import type { z } from 'zod'

const registry: ToolDefinition<z.ZodType>[] = [weatherTool]

export const openaiTools = registry.map(toOpenAITool)

export async function executeToolCall(
  name: string,
  argsJson: string,
): Promise<string> {
  const tool = registry.find((t) => t.name === name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  const args = tool.parameters.parse(JSON.parse(argsJson))
  return tool.execute(args)
}
