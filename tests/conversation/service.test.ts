import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub tool *execution* so the loop runs offline and instantly (the real
// weather tool sleeps 1s and web_search hits the network). Everything else
// from the tools module — describeToolCall, mainTools, forkTools — stays real.
vi.mock('../../src/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools')>()
  return { ...actual, executeToolCall: vi.fn(async () => 'TOOL_RESULT') }
})

import { executeToolCall } from '../../src/tools'
import type { TurnEvent } from '../../src/conversation/events'
import { ConversationService } from '../../src/conversation/service'
import {
  createMockOpenAI,
  createRecordingScope,
  type MockTurn,
} from '../helpers/mock-openai'

const exec = vi.mocked(executeToolCall)

// The ResponseInputItem union is awkward to narrow in tests; view it loosely.
type Item = Record<string, unknown>
const transcript = (service: ConversationService): Item[] => service.items as unknown as Item[]

async function collect(gen: AsyncGenerator<TurnEvent, void>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function makeService(turns: MockTurn[], compressions: string[] = []) {
  const mock = createMockOpenAI(turns, compressions)
  const { scope, state } = createRecordingScope()
  const service = new ConversationService(mock.client, scope)
  return { service, mock, scope, state }
}

beforeEach(() => {
  exec.mockReset()
  exec.mockResolvedValue('TOOL_RESULT')
})

describe('ConversationService.run', () => {
  it('streams a plain answer and yields a final answer event', async () => {
    const { service, mock, state } = makeService([{ text: 'Hello there friend' }])

    const events = await collect(service.run('hi'))

    const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text)
    expect(deltas.join('')).toBe('Hello there friend')

    const answer = events.at(-1)
    expect(answer).toEqual({ type: 'answer', content: 'Hello there friend' })

    // No tools called, one model round, usage recorded.
    expect(exec).not.toHaveBeenCalled()
    expect(mock.calls.stream).toHaveLength(1)
    expect(state.responseUsage).toHaveLength(1)
  })

  it('pushes the user message and records the turn', async () => {
    const { service, scope, state } = makeService([{ text: 'ok' }])
    await collect(service.run('remember this'))

    expect(service.items[0]).toMatchObject({ role: 'user', content: 'remember this' })
    expect(state.finishedTurns).toHaveLength(1)
    expect(scope.summary).toBe('') // one turn, no windowing yet
  })

  it('runs a tool call, feeds the result back, and answers', async () => {
    exec.mockResolvedValueOnce('The weather in Paris is sunny')
    const { service, mock } = makeService([
      { calls: [{ name: 'get_weather_data', arguments: { city: 'Paris' } }] },
      { text: 'It is sunny in Paris.' },
    ])

    const events = await collect(service.run('weather in paris?'))

    // Tool step carries the localized name + arg-derived detail.
    const toolEvent = events.find((e) => e.type === 'tool')
    expect(toolEvent).toMatchObject({ type: 'tool', name: 'get_weather_data', detail: 'Paris' })

    expect(exec).toHaveBeenCalledWith('get_weather_data', JSON.stringify({ city: 'Paris' }))
    expect(mock.calls.stream).toHaveLength(2) // tool round + answer round

    // A function_call_output carrying the tool result is in the transcript.
    const output = transcript(service).find((i) => i.type === 'function_call_output')
    expect(output?.output).toBe('The weather in Paris is sunny')
    expect(events.at(-1)).toEqual({ type: 'answer', content: 'It is sunny in Paris.' })
  })

  it('runs multiple tool calls in one round', async () => {
    const { service } = makeService([
      {
        calls: [
          { name: 'get_weather_data', arguments: { city: 'Paris' } },
          { name: 'get_weather_data', arguments: { city: 'Tokyo' } },
        ],
      },
      { text: 'done' },
    ])

    const events = await collect(service.run('weather in paris and tokyo?'))

    const toolEvents = events.filter((e) => e.type === 'tool')
    expect(toolEvents.map((e) => e.detail)).toEqual(['Paris', 'Tokyo'])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('turns a thrown tool into an error output instead of aborting', async () => {
    exec.mockRejectedValueOnce(new Error('boom'))
    const { service } = makeService([
      { calls: [{ name: 'get_weather_data', arguments: { city: 'Paris' } }] },
      { text: 'recovered' },
    ])

    const events = await collect(service.run('weather?'))

    const output = transcript(service).find((i) => i.type === 'function_call_output')
    expect(output?.output).toBe('Error: boom')
    expect(events.at(-1)).toEqual({ type: 'answer', content: 'recovered' })
  })

  it('delegates: streams the sub-agent tool activity and injects the handoff', async () => {
    const { service, mock } = makeService(
      [
        // main: delegate
        {
          calls: [
            {
              name: 'delegate_task',
              arguments: { title: 'Research SSR', task: 'Research SSR vs SSG' },
            },
          ],
        },
        // child fork (stream:false → parse): search, then answer
        { calls: [{ name: 'web_search', arguments: { query: 'SSR vs SSG' } }] },
        { text: 'child findings' },
        // main: final answer
        { text: 'Here is the summary.' },
      ],
      ['DIGEST-123'],
    )

    const events = await collect(service.run('research ssr vs ssg'))

    // Delegation surfaces the concise title, not the full task.
    expect(events.find((e) => e.type === 'status')).toEqual({
      type: 'status',
      text: 'Delegating: Research SSR',
    })

    // The fork's tool call is streamed up, tagged with the fork title.
    expect(events.find((e) => e.type === 'tool' && e.fork)).toMatchObject({
      type: 'tool',
      name: 'web_search',
      detail: 'SSR vs SSG',
      fork: 'Research SSR',
    })

    // The compressed digest is injected as a developer handoff and as the
    // delegate call's output.
    const handoff = transcript(service).find((i) => i.role === 'developer')
    expect(String(handoff?.content)).toContain('DIGEST-123')

    const delegateOutput = transcript(service).find((i) => i.type === 'function_call_output')
    expect(delegateOutput?.output).toBe('DIGEST-123')

    // The handoff compression went through responses.create exactly once.
    expect(mock.calls.create).toHaveLength(1)
    expect(events.at(-1)).toEqual({ type: 'answer', content: 'Here is the summary.' })
  })

  it('forbids tools on the final round to stop an infinite tool loop', async () => {
    // 8 tool-calling rounds, then a forced answer.
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: 'get_weather_data', arguments: { city: 'Paris' } }],
    }))
    turns.push({ text: 'forced answer' })

    const { service, mock } = makeService(turns)
    const events = await collect(service.run('loop forever'))

    expect(exec).toHaveBeenCalledTimes(8)
    // The 9th (final) request must disable tools.
    const lastParams = mock.calls.stream.at(-1) as { tools: unknown[] }
    expect(mock.calls.stream).toHaveLength(9)
    expect(lastParams.tools).toEqual([])
    expect(events.at(-1)).toEqual({ type: 'answer', content: 'forced answer' })
  })

  it('summarizes and trims once the window overflows KEEP_LAST_TURNS', async () => {
    // 5 plain turns > KEEP_LAST_TURNS (4) triggers one summarization.
    const turns: MockTurn[] = Array.from({ length: 5 }, (_, i) => ({ text: `answer ${i}` }))
    const { service, mock, scope } = makeService(turns, ['ROLLING SUMMARY'])

    for (let i = 0; i < 5; i++) {
      await collect(service.run(`question ${i}`))
    }

    expect(mock.calls.create).toHaveLength(1) // one summarizer call
    expect(scope.summary).toBe('ROLLING SUMMARY')
  })
})
