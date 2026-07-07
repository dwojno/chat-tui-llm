import type { OpenAI } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems.mjs'
import type { ParsedResponse } from 'openai/resources/responses/responses.mjs'
import type { ResponseInputItem } from 'openai/resources/responses/responses.mjs'
import { COMPACT_AFTER_TURNS, MODEL, SYSTEM_INSTRUCTIONS } from '../config'
import { formatResponse } from './format'
import {
  DEFAULT_GET_RESPONSE_OPTIONS,
  type GetResponseOptions,
} from './schemas'
import { executeToolCall, openaiTools } from '../tools'
import {
  getFunctionCalls,
  hasFunctionCalls,
  toReplayInputItems,
  turnsSinceLastCompaction,
} from './items'

export class ConversationService {
  private conversation: ResponseInputItem[] = []

  constructor(private readonly openai: OpenAI) {}

  get items(): readonly ResponseInputItem[] {
    return this.conversation
  }

  pushUserMessage(content: string): ResponseInputItem {
    const message = { role: 'user', content } satisfies ResponseInputItem
    this.conversation.push(message)
    return message
  }

  private buildRequestParams(options: GetResponseOptions) {
    return {
      model: MODEL,
      input: this.conversation,
      instructions: SYSTEM_INSTRUCTIONS,
      text: options.structured_output
        ? {
            format: zodTextFormat(options.structured_output, 'response_schema'),
          }
        : options.json_mode
          ? { format: { type: 'json_object' as const } }
          : undefined,
      temperature: options.temperature,
      max_output_tokens: options.max_output_tokens,
      store: false as const,
      tools: openaiTools,
    }
  }

  private async fetchResponse(
    options: GetResponseOptions,
    onDelta?: (delta: string) => void,
  ): Promise<ParsedResponse<unknown>> {
    const params = this.buildRequestParams(options)

    if (options.stream) {
      const stream = this.openai.responses.stream(params)
      if (onDelta) {
        stream.on('response.output_text.delta', (event) => onDelta(event.delta))
      }
      return stream.finalResponse()
    }

    return this.openai.responses.parse(params)
  }

  async completeTurn(
    options: GetResponseOptions = DEFAULT_GET_RESPONSE_OPTIONS,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    let response = await this.fetchResponse(options, onDelta)

    // The model may emit tool calls before its final answer. Each round keeps
    // the same `options` (streaming + structured/json format) so the answer
    // that ends the loop is still formatted and streamed to the UI.
    while (hasFunctionCalls(response.output)) {
      this.conversation.push(...toReplayInputItems(response.output))

      for (const call of getFunctionCalls(response.output)) {
        const output = await executeToolCall(call.name, call.arguments)
        this.conversation.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        })
      }

      response = await this.fetchResponse(options, onDelta)
    }

    this.conversation.push(...toResponseInputItems(response.output))
    await this.compactIfNeeded()

    return formatResponse(response, options)
  }

  private async compactIfNeeded(): Promise<void> {
    if (turnsSinceLastCompaction(this.conversation) < COMPACT_AFTER_TURNS) {
      return
    }

    const compacted = await this.openai.responses.compact({
      model: MODEL,
      input: this.conversation,
      instructions: SYSTEM_INSTRUCTIONS,
    })

    // The compacted window is the canonical next context — use it as-is.
    this.conversation = toResponseInputItems(compacted.output)
  }
}
