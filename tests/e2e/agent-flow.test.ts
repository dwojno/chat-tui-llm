import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Headless Ink so we can assert on the committed message list (see chat.test).
vi.mock('ink', () => ({
  render: () => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: () => Promise.resolve(),
  }),
  Box: (props: { children?: unknown }) => props.children,
  Text: (props: { children?: unknown }) => props.children,
  Static: () => null,
  useInput: () => {},
}))

import { processLine } from '../../src/cli/repl'
import type { CommandContext } from '../../src/commands/types'
import { ConversationService } from '../../src/conversation/service'
import { SessionState } from '../../src/conversation/state'
import { renderChat, type ChatHandle, type Message } from '../../src/ui/chat'
import {
  createMockOpenAI,
  createThrowingOpenAI,
  type MockTurn,
} from '../helpers/mock-openai'
import type { OpenAI } from 'openai'

/**
 * End-to-end through the real REPL adapter: a raw input line → command routing
 * → the agent loop → real tools/forks → rendered chat. Only the model (and
 * `fetch`, for web_search) is mocked. Each case asserts on what a user would
 * actually see land in the transcript.
 */

let dir: string

interface Harness {
  chat: ChatHandle
  service: ConversationService
  ctx: CommandContext
  state: SessionState
  run: (line: string) => Promise<'exit' | 'continue'>
  lastAssistant: () => Message | undefined
  toolOutputs: () => string[]
}

function setup(client: OpenAI): Harness {
  const state = SessionState.load(join(dir, 'session.json'))
  const service = new ConversationService(client, state)
  const chat = renderChat([], { interactive: false })
  const ctx: CommandContext = { temperature: 0.7, state, chat }
  return {
    chat,
    service,
    ctx,
    state,
    run: (line) => processLine(line, ctx, chat, service),
    lastAssistant: () =>
      [...chat.messages].reverse().find((m) => m.role === 'assistant'),
    // The transcript's function_call_output entries carry tool results/errors.
    toolOutputs: () =>
      (service.items as unknown as Record<string, string>[])
        .filter((i) => i.type === 'function_call_output')
        .map((i) => i.output),
  }
}

const mocked = (turns: MockTurn[], compressions: string[] = []): Harness =>
  setup(createMockOpenAI(turns, compressions).client)

/** Stub global fetch (web_search's backend) with a canned implementation. */
function stubFetch(impl: () => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => impl()),
  )
}
const searchHits = (hits: { title: string; snippet: string }[]) => ({
  ok: true,
  json: async () => ({ query: { search: hits } }),
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'chat-e2e-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(dir, { recursive: true, force: true })
})

describe('E2E: happy paths', () => {
  it('answers a plain message', async () => {
    const h = mocked([{ text: 'Hello!' }])
    await h.run('hi there')
    expect(h.chat.messages).toEqual([
      { role: 'user', content: 'hi there' },
      { role: 'assistant', content: 'Hello!', steps: undefined },
    ])
  })

  it('/remember pins a fact without a model turn', async () => {
    const h = mocked([])
    const result = await h.run('/remember I like tea')
    expect(result).toBe('continue')
    expect(h.state.facts).toContain('I like tea')
    expect(h.lastAssistant()?.content).toContain('Remembered')
  })

  it('exit stops the loop', async () => {
    const h = mocked([])
    expect(await h.run('exit')).toBe('exit')
    expect(h.chat.messages).toEqual([])
  })

  it('renders structured output as answer + sources', async () => {
    const h = mocked([{ text: '', parsed: { answer: '42', sources: ['s1'] } }])
    await h.run('/structured what is the answer?')
    expect(h.lastAssistant()?.content).toBe('42\n\nSources: s1')
  })
})

describe('E2E: bad LLM output', () => {
  it('renders an empty answer when structured output fails to parse', async () => {
    // Schema validation failed upstream → output_parsed is null.
    const h = mocked([{ text: '', parsed: null }])
    await h.run('/structured give me json')
    expect(h.lastAssistant()).toMatchObject({ role: 'assistant', content: '' })
  })

  it('commits an empty assistant turn when the model returns no text', async () => {
    const h = mocked([{ text: '' }])
    await h.run('say nothing')
    expect(h.lastAssistant()?.content).toBe('')
  })
})

describe('E2E: tool-call failures recover via the error-output path', () => {
  it('unknown tool → error fed back → model recovers', async () => {
    const h = mocked([
      { calls: [{ name: 'do_magic', arguments: {} }] },
      { text: 'I could not do that, here is a normal answer.' },
    ])
    await h.run('do magic')
    expect(h.toolOutputs()[0]).toMatch(/Unknown tool: do_magic/)
    expect(h.lastAssistant()?.content).toContain('normal answer')
  })

  it('malformed tool arguments → schema error fed back → recovers', async () => {
    const h = mocked([
      { calls: [{ name: 'get_weather_data', arguments: {} }] }, // missing `city`
      { text: 'Which city did you mean?' },
    ])
    await h.run('weather?')
    expect(h.toolOutputs()[0]).toMatch(/^Error:/)
    expect(h.lastAssistant()?.content).toContain('city')
  })

  it('invalid JSON arguments → parse error fed back → recovers', async () => {
    const h = mocked([
      { calls: [{ name: 'get_weather_data', arguments: 'not json' }] },
      { text: 'recovered from bad json' },
    ])
    await h.run('weather?')
    expect(h.toolOutputs()[0]).toMatch(/^Error:/)
    expect(h.lastAssistant()?.content).toContain('recovered')
  })

  it('caps runaway tool loops and forces an answer (MAX_TOOL_STEPS)', async () => {
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: 'do_magic', arguments: {} }],
    }))
    turns.push({ text: 'forced final answer' })
    const h = mocked(turns)
    await h.run('loop please')
    expect(h.toolOutputs()).toHaveLength(8)
    expect(h.lastAssistant()?.content).toBe('forced final answer')
  })
})

describe('E2E: model/API failure', () => {
  it('surfaces an API error in the transcript instead of crashing the REPL', async () => {
    const h = setup(createThrowingOpenAI('API down'))
    const result = await h.run('hello')
    expect(result).toBe('continue') // REPL survives
    expect(h.lastAssistant()?.content).toBe('⚠️ API down')
  })
})

describe('E2E: delegation', () => {
  it('streams the sub-agent tool activity and folds in the handoff', async () => {
    stubFetch(() =>
      searchHits([{ title: 'SSR', snippet: 'renders on the <b>server</b>' }]),
    )
    const h = mocked(
      [
        {
          calls: [
            {
              name: 'delegate_task',
              arguments: { title: 'Research SSR', task: 'research ssr' },
            },
          ],
        },
        { calls: [{ name: 'web_search', arguments: { query: 'ssr' } }] }, // child
        { text: 'child done' }, // child answer
        { text: 'Final synthesized answer.' }, // main
      ],
      ['HANDOFF DIGEST'],
    )

    await h.run('research ssr for me')

    const assistant = h.lastAssistant()
    expect(assistant?.content).toBe('Final synthesized answer.')
    // The fork's web_search shows up as a nested, tagged step.
    expect(assistant?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Searching the web',
          detail: 'ssr',
          fork: 'Research SSR',
        }),
      ]),
    )
  })

  it('isolates an ERROR on a sub-agent tool call — the fork recovers and the parent still answers', async () => {
    stubFetch(() => {
      throw new Error('network down')
    })
    const h = mocked(
      [
        {
          calls: [
            {
              name: 'delegate_task',
              arguments: { title: 'Research', task: 'research' },
            },
          ],
        },
        { calls: [{ name: 'web_search', arguments: { query: 'q' } }] }, // child search fails
        { text: 'child answered from knowledge' }, // child recovers
        { text: 'parent final answer' },
      ],
      ['DIGEST'],
    )

    await h.run('research something')
    expect(h.lastAssistant()?.content).toBe('parent final answer')
  })

  it('isolates a TIMEOUT on a sub-agent tool call the same way', async () => {
    stubFetch(() => {
      throw Object.assign(new Error('The operation timed out'), {
        name: 'TimeoutError',
      })
    })
    const h = mocked(
      [
        {
          calls: [
            {
              name: 'delegate_task',
              arguments: { title: 'Research', task: 'research' },
            },
          ],
        },
        { calls: [{ name: 'web_search', arguments: { query: 'q' } }] },
        { text: 'child continued despite the timeout' },
        { text: 'parent answer after timeout' },
      ],
      ['DIGEST'],
    )

    await h.run('research something')
    expect(h.lastAssistant()?.content).toBe('parent answer after timeout')
  })

  it('malformed delegate arguments → error fed back → recovers', async () => {
    const h = mocked([
      { calls: [{ name: 'delegate_task', arguments: { title: 'X' } }] }, // missing `task`
      { text: 'handled the bad delegation' },
    ])
    await h.run('delegate badly')
    expect(h.toolOutputs()[0]).toMatch(/^Error:/)
    expect(h.lastAssistant()?.content).toContain('handled')
  })

  it('runs multiple delegations in one turn (parallel forks)', async () => {
    const mock = createMockOpenAI(
      [
        {
          calls: [
            {
              name: 'delegate_task',
              arguments: { title: 'Task A', task: 'a' },
            },
            {
              name: 'delegate_task',
              arguments: { title: 'Task B', task: 'b' },
            },
          ],
        },
        { text: 'child A done' }, // one child (direct answer, no tool)
        { text: 'child B done' }, // other child
        { text: 'combined answer' }, // main
      ],
      ['DIGEST A', 'DIGEST B'],
    )
    const h = setup(mock.client)

    await h.run('do two things')

    expect(h.lastAssistant()?.content).toBe('combined answer')
    // Both delegations surfaced as steps, and both forks were compressed.
    const stepLabels = (h.lastAssistant()?.steps ?? []).map((s) => s.label)
    expect(stepLabels).toEqual(
      expect.arrayContaining(['Delegating: Task A', 'Delegating: Task B']),
    )
    expect(mock.calls.create).toHaveLength(2)
  })
})
