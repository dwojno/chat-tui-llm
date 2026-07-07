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
import { executeToolCall, mainTools } from '../tools'
import {
  DELEGATE_TASK_NAME,
  parseDelegateTaskArgs,
} from '../tools/delegate-task'
import {
  countUserTurns,
  getFunctionCalls,
  hasFunctionCalls,
  renderItemsText,
  splitAtLastTurns,
  toReplayInputItems,
} from './items'
import { runFork } from './fork'
import type { ConversationScope } from './scope'
import { estimateTokens } from './state'
import { summarize } from './summarizer'

type OpenAITool = (typeof mainTools)[number]

export type ServiceOptions = {
  instructions?: string
  tools?: OpenAITool[]
  keepLastTurns?: number
}

export class ConversationService {
  private conversation: ResponseInputItem[] = []
  private readonly instructions: string
  private readonly tools: OpenAITool[]
  private readonly keepLastTurns: number

  constructor(
    private readonly openai: OpenAI,
    private readonly scope: ConversationScope,
    options: ServiceOptions = {},
  ) {
    this.instructions = options.instructions ?? SYSTEM_INSTRUCTIONS
    this.tools = options.tools ?? mainTools
    this.keepLastTurns = options.keepLastTurns ?? KEEP_LAST_TURNS
  }

  get items(): readonly ResponseInputItem[] {
    return this.conversation
  }

  pushUserMessage(content: string): ResponseInputItem {
    const message = { role: 'user', content } satisfies ResponseInputItem
    this.conversation.push(message)
    this.scope.growNaive?.(`user: ${content}`)
    return message
  }

  /** Inject a compressed fork handoff into the main transcript. */
  injectForkHandoff(task: string, digest: string): void {
    const content = [
      '<fork_handoff>',
      `Task: ${task}`,
      'Sub-agent completed. Use this as background — do not mention the fork unless asked.',
      '',
      digest,
      '</fork_handoff>',
    ].join('\n')

    this.conversation.push({
      role: 'developer',
      content,
    } satisfies ResponseInputItem)
    this.scope.growNaive?.(`fork handoff: ${digest}`)
  }

  /**
   * Out-of-window context (pinned facts + rolling summary) as one developer
   * message, structured with XML sections. Placed LAST in the input — after the
   * stable conversation prefix — so that a `/remember` or a re-summarization
   * changes only the tail and never invalidates the cached prefix above it.
   */
  private contextBlock(): ResponseInputItem[] {
    const sections: string[] = []
    if (this.scope.facts.length) {
      sections.push(
        `<user_known_facts>\n- ${this.scope.facts.join('\n- ')}\n</user_known_facts>`,
      )
    }
    if (this.scope.summary) {
      sections.push(
        `<conversation_summary>\n${this.scope.summary}\n</conversation_summary>`,
      )
    }
    if (!sections.length) return []

    const content = [
      '<context>',
      'Background memory carried outside the live transcript. Rules:',
      '- Treat stored facts as quiet notes — never volunteer them on greetings, small talk, or unrelated messages.',
      "- Do not mention, offer, or ask about stored facts unless the user's current message clearly calls for it.",
      '- Use a fact only when directly relevant (e.g. they ask for a joke, ask what you know about them, or the topic matches).',
      '- When in doubt, respond only to what the user actually said.',
      '- Use the conversation summary for continuity when the live transcript is incomplete.',
      '',
      ...sections,
      '</context>',
    ].join('\n')

    return [{ role: 'developer', content } satisfies ResponseInputItem]
  }

  private buildRequestParams(options: TurnOptions) {
    return {
      model: MODEL,
      input: [...this.conversation, ...this.contextBlock()],
      instructions: this.instructions,
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
      tools: this.tools,
      prompt_cache_key: this.scope.cacheKey,
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
      this.scope.addResponseUsage(final.usage)
      return final
    }

    const response = await this.openai.responses.parse(params)
    this.scope.addResponseUsage(response.usage)
    return response
  }

  private async runDelegateFork(task: string): Promise<string> {
    return runFork(this.openai, this.scope, task)
  }

  async completeTurn(
    options: TurnOptions = DEFAULT_TURN_OPTIONS,
    onDelta?: (delta: string) => void,
    onForkStart?: (status: string) => void,
  ): Promise<string> {
    const naiveInput =
      this.scope.snapshotNaiveInput?.(estimateTokens(this.instructions)) ?? 0

    let response = await this.fetchResponse(options, onDelta)

    while (hasFunctionCalls(response.output)) {
      const replay = toReplayInputItems(response.output)
      this.conversation.push(...replay)
      this.scope.growNaive?.(renderItemsText(replay))

      for (const call of getFunctionCalls(response.output)) {
        let output: string

        if (call.name === DELEGATE_TASK_NAME) {
          const { task } = parseDelegateTaskArgs(call.arguments)
          onForkStart?.(`Delegating: ${task}...`)
          const digest = await this.runDelegateFork(task)
          this.injectForkHandoff(task, digest)
          output = digest
        } else {
          output = await executeToolCall(call.name, call.arguments)
        }

        this.conversation.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        })
        this.scope.growNaive?.(`tool result: ${output}`)
      }

      response = await this.fetchResponse(options, onDelta)
    }

    const finalItems = toResponseInputItems(response.output)
    this.conversation.push(...finalItems)
    this.scope.growNaive?.(renderItemsText(finalItems))

    this.scope.finishTurn?.(naiveInput)
    await this.maintainWindow()

    return formatResponse(response, options)
  }

  /**
   * Deterministic truncation: keep only the last `keepLastTurns` turns in the
   * window and fold everything older into the rolling summary (out-of-window
   * state). Runs once per turn, after the answer is committed.
   */
  private async maintainWindow(): Promise<void> {
    if (countUserTurns(this.conversation) <= this.keepLastTurns) {
      return
    }

    const { evicted, kept } = splitAtLastTurns(
      this.conversation,
      this.keepLastTurns,
    )
    if (!evicted.length) {
      return
    }

    const { text, usage } = await summarize(
      this.openai,
      this.scope.summary,
      evicted,
    )
    this.scope.addSummarizerUsage(usage)
    this.scope.setSummary(text)
    this.conversation = kept
  }
}
