import type { OpenAI } from 'openai'
import type { ResponseUsage } from 'openai/resources/responses/responses.mjs'

/**
 * Test doubles for the OpenAI Responses API. The app injects the client
 * everywhere (ConversationService, summarize, compressHandoff), so a fake that
 * shapes just the fields the code reads — `output`, `output_text`,
 * `output_parsed`, `usage` — is enough to drive the whole agent loop offline.
 *
 * `createMockOpenAI(turns, compressions)` scripts a run:
 * - `turns`   feed `responses.stream` / `responses.parse` (one per model round,
 *             in call order) — the model's decisions.
 * - `compressions` feed `responses.create` (summarizer + fork handoffs).
 */

let counter = 0
const nextId = (prefix: string): string => `${prefix}_${counter++}`

/** A minimal but structurally-valid `ResponseUsage`. */
export function usage(overrides: Partial<ResponseUsage> = {}): ResponseUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
    ...overrides,
  } as ResponseUsage
}

/** An assistant `message` output item carrying `text`. */
export function assistantMessage(text: string) {
  return {
    type: 'message',
    id: nextId('msg'),
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [] }],
  }
}

/** A `function_call` output item. `args` may be an object (JSON-encoded) or raw string. */
export function functionCall(
  name: string,
  args: string | Record<string, unknown> = {},
  callId = nextId('call'),
) {
  return {
    type: 'function_call',
    id: nextId('fc'),
    call_id: callId,
    name,
    arguments: typeof args === 'string' ? args : JSON.stringify(args),
    status: 'completed',
  }
}

/** One scripted model round. */
export interface MockTurn {
  /** Answer text (streamed as deltas, and set as `output_text`). */
  text?: string
  /** Tool calls the model requests this round. */
  calls?: { name: string; arguments?: string | Record<string, unknown>; callId?: string }[]
  /** `output_parsed` for structured-output turns. */
  parsed?: unknown
  usage?: ResponseUsage
}

function buildResponse(turn: MockTurn) {
  const output = [
    ...(turn.calls ?? []).map((c) => functionCall(c.name, c.arguments, c.callId)),
    ...(turn.text !== undefined ? [assistantMessage(turn.text)] : []),
  ]
  return {
    output,
    output_text: turn.text ?? '',
    output_parsed: turn.parsed ?? null,
    usage: turn.usage ?? usage(),
  }
}

/** Split answer text into a few streamed deltas, mimicking token streaming. */
function toDeltas(text: string): string[] {
  if (!text) return []
  const words = text.split(/(\s+)/).filter(Boolean)
  return words.length > 1 ? words : [text]
}

function makeStream(turn: MockTurn) {
  const final = buildResponse(turn)
  const deltas = toDeltas(turn.text ?? '')
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { type: 'response.output_text.delta', delta }
      }
    },
    finalResponse: async () => final,
  }
}

export interface MockOpenAI {
  client: OpenAI
  /** Recorded request params, per method, in call order. */
  calls: {
    stream: unknown[]
    parse: unknown[]
    create: unknown[]
  }
  /** How many scripted turns remain unconsumed. */
  turnsRemaining: () => number
}

/**
 * Build a fake OpenAI client that replays `turns` through `stream`/`parse` and
 * `compressions` through `create`. Unscripted calls degrade to an empty answer
 * / generic summary so a test only scripts what it asserts on.
 */
export function createMockOpenAI(
  turns: MockTurn[] = [],
  compressions: string[] = [],
): MockOpenAI {
  const turnQueue = [...turns]
  const compQueue = [...compressions]
  const calls = { stream: [] as unknown[], parse: [] as unknown[], create: [] as unknown[] }

  const nextTurn = (): MockTurn => turnQueue.shift() ?? { text: '' }

  const client = {
    responses: {
      stream: (params: unknown) => {
        calls.stream.push(params)
        return makeStream(nextTurn())
      },
      parse: async (params: unknown) => {
        calls.parse.push(params)
        return buildResponse(nextTurn())
      },
      create: async (params: unknown) => {
        calls.create.push(params)
        return { output_text: compQueue.shift() ?? 'compressed summary', usage: usage() }
      },
    },
  }

  return {
    client: client as unknown as OpenAI,
    calls,
    turnsRemaining: () => turnQueue.length,
  }
}

/** A recording {@link ConversationScope} for exercising service/fork in isolation. */
export function createRecordingScope(
  init: { summary?: string; facts?: string[] } = {},
) {
  const state = {
    summary: init.summary ?? '',
    facts: init.facts ?? [],
    cacheKey: 'chat-cli:test',
    responseUsage: [] as (ResponseUsage | undefined)[],
    summarizerUsage: [] as (ResponseUsage | undefined)[],
    naive: [] as string[],
    finishedTurns: [] as number[],
  }
  const scope = {
    get summary() {
      return state.summary
    },
    get facts() {
      return state.facts as readonly string[]
    },
    get cacheKey() {
      return state.cacheKey
    },
    setSummary(s: string) {
      state.summary = s
    },
    addResponseUsage(u: ResponseUsage | undefined) {
      state.responseUsage.push(u)
    },
    addSummarizerUsage(u: ResponseUsage | undefined) {
      state.summarizerUsage.push(u)
    },
    growNaive(text: string) {
      state.naive.push(text)
    },
    finishTurn(n: number) {
      state.finishedTurns.push(n)
    },
    snapshotNaiveInput() {
      return 0
    },
  }
  return { scope, state }
}
