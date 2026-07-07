import { toResponseInputItem } from 'openai/lib/responses/ResponseInputItems.mjs'
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses.mjs'

export function hasFunctionCalls(output: ResponseOutputItem[]): boolean {
  return output.some((item) => item.type === 'function_call')
}

export function getFunctionCalls(
  output: ResponseOutputItem[],
): ResponseFunctionToolCall[] {
  return output.filter((item) => item.type === 'function_call')
}

/**
 * Normalize output items into replayable input items. `function_call` items are
 * rebuilt by hand: the streaming/parse helpers attach a `parsed_arguments`
 * field that is not a valid request parameter, so `toResponseInputItem` (which
 * only strips `created_by`) would leave it in and the API rejects the replay.
 */
export function toReplayInputItems(
  items: ResponseOutputItem[],
): ResponseInputItem[] {
  const inputItems: ResponseInputItem[] = []

  for (const item of items) {
    if (item.type === 'function_call') {
      inputItems.push({
        type: 'function_call',
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      })
      continue
    }

    const inputItem = toResponseInputItem(item)
    if (inputItem) {
      inputItems.push(inputItem)
    }
  }

  return inputItems
}

/** Count completed user turns (user messages) in a window. */
export function countUserTurns(items: ResponseInputItem[]): number {
  return items.filter((item) => 'role' in item && item.role === 'user').length
}

/**
 * Split a window into the turns to keep and the ones to evict, cutting at a
 * user-message boundary so tool calls stay attached to their turn. Keeps the
 * last `keepTurns` user turns; everything before the cut is `evicted`.
 */
export function splitAtLastTurns(
  items: ResponseInputItem[],
  keepTurns: number,
): { evicted: ResponseInputItem[]; kept: ResponseInputItem[] } {
  const userIndices = items.flatMap((item, index) =>
    'role' in item && item.role === 'user' ? [index] : [],
  )

  if (userIndices.length <= keepTurns) {
    return { evicted: [], kept: items }
  }

  const cut = userIndices[userIndices.length - keepTurns]
  return { evicted: items.slice(0, cut), kept: items.slice(cut) }
}

/**
 * Extract the plain-text of a message's `content`, which may be a bare string
 * or an array of parts (text parts contribute their `text`; others are empty).
 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      return part && typeof part === 'object' && 'text' in part
        ? String(part.text)
        : ''
    })
    .join('')
}

/** Flatten items into plain text for feeding the summarizer. */
export function renderItemsText(items: ResponseInputItem[]): string {
  const lines: string[] = []

  for (const item of items) {
    if ('role' in item && 'content' in item) {
      const text = contentToText(item.content)
      if (text) lines.push(`${item.role}: ${text}`)
      continue
    }

    if (item.type === 'function_call') {
      lines.push(`assistant called ${item.name}(${item.arguments})`)
    } else if (item.type === 'function_call_output') {
      lines.push(`tool result: ${item.output}`)
    }
  }

  return lines.join('\n')
}
