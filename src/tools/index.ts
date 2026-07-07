import { weatherTool } from './weather'
import { delegateTaskDefinition, toDelegateTaskOpenAITool } from './delegate-task'
import { toOpenAITool, type ToolDefinition } from './types'
import type { z } from 'zod'

const executableRegistry: ToolDefinition<z.ZodType>[] = [weatherTool]

/** Tools the main model may call (includes schema-only delegate_task). */
export const mainTools = [
  toOpenAITool(weatherTool),
  toDelegateTaskOpenAITool(),
]

/** Tools available inside a fork — delegate_task excluded to prevent recursion. */
export const forkTools = [toOpenAITool(weatherTool)]

/** @deprecated Use mainTools — kept for any external importers. */
export const openaiTools = mainTools

export async function executeToolCall(
  name: string,
  argsJson: string,
): Promise<string> {
  if (name === delegateTaskDefinition.name) {
    throw new Error(`${name} is executed by ConversationService, not executeToolCall`)
  }

  const tool = executableRegistry.find((t) => t.name === name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  const args = tool.parameters.parse(JSON.parse(argsJson))
  return tool.execute(args)
}
