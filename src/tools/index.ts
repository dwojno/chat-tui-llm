import { weatherTool } from './weather'
import { webSearchTool } from './web-search'
import { delegateTaskDefinition, toDelegateTaskOpenAITool } from './delegate-task'
import { toOpenAITool, type ToolDefinition } from './types'
import type { z } from 'zod'

const executableRegistry: ToolDefinition<z.ZodType>[] = [weatherTool, webSearchTool]

/** Tools the main model may call (includes schema-only delegate_task). */
export const mainTools = [
  toOpenAITool(weatherTool),
  toDelegateTaskOpenAITool(),
]

/**
 * Tools available inside a fork — delegate_task excluded to prevent recursion.
 * Forks get web_search so delegated research has a relevant tool (the main
 * agent delegates research rather than searching directly, so it doesn't).
 */
export const forkTools = [toOpenAITool(weatherTool), toOpenAITool(webSearchTool)]

/** @deprecated Use mainTools — kept for any external importers. */
export const openaiTools = mainTools

/**
 * A short human-readable detail for a specific tool call (e.g. the query or
 * city), derived from its structured arguments via the tool's `summarize`.
 * Returns undefined when the tool has no summarizer or the args don't parse —
 * the UI then shows just the static label.
 */
export function describeToolCall(
  name: string,
  argsJson: string,
): string | undefined {
  const tool = executableRegistry.find((t) => t.name === name)
  if (!tool?.summarize) return undefined
  try {
    return tool.summarize(tool.parameters.parse(JSON.parse(argsJson)))
  } catch {
    return undefined
  }
}

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
