import type { OpenAI } from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { toResponseInputItems } from 'openai/lib/responses/ResponseInputItems.mjs'
import type {
  ParsedResponse,
  ResponseInputItem,
} from 'openai/resources/responses/responses.mjs'
import { KEEP_LAST_TURNS, MODEL, SYSTEM_INSTRUCTIONS } from '../config'
import { formatResponse } from './format'
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from './options'
import { executeToolCall, openaiTools } from '../tools'
import {
  countUserTurns,
  getFunctionCalls,
  hasFunctionCalls,
  renderItemsText,
  splitAtLastTurns,
  toReplayInputItems,
} from './items'
import { estimateTokens, type SessionState } from './state'
import { summarize } from './summarizer'

export class ConversationService {
  private conversation: ResponseInputItem[] = []

  constructor(
    private readonly openai: OpenAI,
    private readonly state: SessionState,
  ) {}

  get items(): readonly ResponseInputItem[] {
    return this.conversation
  }

  pushUserMessage(content: string): ResponseInputItem {
    const message = { role: 'user', content } satisfies ResponseInputItem
    this.conversation.push(message)
    this.state.growNaive(`user: ${content}`)
    return message
  }

  /**
   * Out-of-window context (pinned facts + rolling summary) as one developer
   * message, structured with XML sections. Placed LAST in the input — after the
   * stable conversation prefix — so that a `/remember` or a re-summarization
   * changes only the tail and never invalidates the cached prefix above it.
   */
  private contextBlock(): ResponseInputItem[] {
    const sections: string[] = []
    if (this.state.facts.length) {
      sections.push(
        `<known_facts>\n- ${this.state.facts.join('\n- ')}\n</known_facts>`,
      )
    }
    if (this.state.summary) {
      sections.push(
        `<conversation_summary>\n${this.state.summary}\n</conversation_summary>`,
      )
    }
    if (!sections.length) return []

    const content = [
      '<context>',
      'Reference information carried outside the live transcript. Use it when relevant; answer the most recent user message above.',
      '',
      ...sections,
      '</context>',
    ].join('\n')

    return [{ role: 'developer', content } satisfies ResponseInputItem]
  }

  private buildRequestParams(options: TurnOptions) {
    return {
      model: MODEL,
      // Static prefix (instructions + tools) → stable conversation → dynamic
      // context block last, to maximize prompt-cache prefix hits.
      input: [...this.conversation, ...this.contextBlock()],
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
      // Stable prefix (instructions + tools + facts/summary) + stable key keep
      // prompt-cache hit rates high across turns.
      prompt_cache_key: this.state.cacheKey,
    }
  }

  private async fetchResponse(
    options: TurnOptions,
    onDelta?: (delta: string) => void,
  ): Promise<ParsedResponse<unknown>> {
    const params = this.buildRequestParams(options)

    if (options.stream) {
      const stream = this.openai.responses.stream(params)
      if (onDelta) {
        stream.on('response.output_text.delta', (event) => onDelta(event.delta))
      }
      const final = await stream.finalResponse()
      this.state.addResponseUsage(final.usage)
      return final
    }

    const response = await this.openai.responses.parse(params)
    this.state.addResponseUsage(response.usage)
    return response
  }

  async completeTurn(
    options: TurnOptions = DEFAULT_TURN_OPTIONS,
    onDelta?: (delta: string) => void,
  ): Promise<string> {
    // What a naive append-everything bot would have sent as input this turn.
    const naiveInput = this.state.snapshotNaiveInput(
      estimateTokens(SYSTEM_INSTRUCTIONS),
    )

    let response = await this.fetchResponse(options, onDelta)

    // The model may emit tool calls before its final answer. Each round keeps
    // the same `options` (streaming + structured/json format) so the answer
    // that ends the loop is still formatted and streamed to the UI.
    while (hasFunctionCalls(response.output)) {
      const replay = toReplayInputItems(response.output)
      this.conversation.push(...replay)
      this.state.growNaive(renderItemsText(replay))

      for (const call of getFunctionCalls(response.output)) {
        const output = await executeToolCall(call.name, call.arguments)
        this.conversation.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        })
        this.state.growNaive(`tool result: ${output}`)
      }

      response = await this.fetchResponse(options, onDelta)
    }

    const finalItems = toResponseInputItems(response.output)
    this.conversation.push(...finalItems)
    this.state.growNaive(renderItemsText(finalItems))

    this.state.finishTurn(naiveInput)
    await this.maintainWindow()

    return formatResponse(response, options)
  }

  /**
   * Deterministic truncation: keep only the last `KEEP_LAST_TURNS` turns in the
   * window and fold everything older into the rolling summary (out-of-window
   * state). Runs once per turn, after the answer is committed.
   */
  private async maintainWindow(): Promise<void> {
    if (countUserTurns(this.conversation) <= KEEP_LAST_TURNS) {
      return
    }

    const { evicted, kept } = splitAtLastTurns(
      this.conversation,
      KEEP_LAST_TURNS,
    )
    if (!evicted.length) {
      return
    }

    const { text, usage } = await summarize(
      this.openai,
      this.state.summary,
      evicted,
    )
    this.state.addSummarizerUsage(usage)
    this.state.setSummary(text)
    this.conversation = kept
  }
}
