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

/** Index of the most recent compaction item, or -1 if none. */
export function findLastCompactionIndex(items: ResponseInputItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'compaction') {
      return i
    }
  }
  return -1
}

/** User turns completed since the most recent compaction item. */
export function turnsSinceLastCompaction(items: ResponseInputItem[]): number {
  const start = findLastCompactionIndex(items) + 1
  let turns = 0
  for (let i = start; i < items.length; i++) {
    const item = items[i]
    if ('role' in item && item.role === 'user') {
      turns++
    }
  }
  return turns
}
