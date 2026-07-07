import 'dotenv/config'
import { OpenAI } from 'openai'
import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { renderChat } from './ui/chat'
import { ConversationService } from './conversation/service'
import { SessionState } from './conversation/state'
import { STATE_FILE } from './config'
import {
  DEFAULT_GET_RESPONSE_OPTIONS,
  ResponseSchema,
  type GetResponseOptions,
} from './conversation/schemas'

const STRUCTURED_PREFIX = '/structured '
const JSON_MODE_PREFIX = '/json '
const REMEMBER_PREFIX = '/remember '

function parseTemperature(): number {
  for (const flag of ['--temperature', '-t']) {
    const index = process.argv.indexOf(flag)
    if (index !== -1) {
      const value = Number(process.argv[index + 1])
      if (!Number.isNaN(value)) {
        return value
      }
    }
  }

  return DEFAULT_GET_RESPONSE_OPTIONS.temperature
}

function resolveTurnOptions(userInput: string): {
  content: string
  options: GetResponseOptions
} {
  const temperature = parseTemperature()

  if (userInput.startsWith(STRUCTURED_PREFIX)) {
    return {
      content: userInput.slice(STRUCTURED_PREFIX.length).trim(),
      options: {
        stream: true,
        temperature,
        max_output_tokens: DEFAULT_GET_RESPONSE_OPTIONS.max_output_tokens,
        structured_output: ResponseSchema,
        json_mode: false,
      },
    }
  }

  if (userInput.startsWith(JSON_MODE_PREFIX)) {
    const prompt = userInput.slice(JSON_MODE_PREFIX.length).trim()
    return {
      content: `${prompt}\n\nRespond in JSON format.`,
      options: {
        stream: true,
        temperature,
        max_output_tokens: DEFAULT_GET_RESPONSE_OPTIONS.max_output_tokens,
        structured_output: undefined,
        json_mode: true,
      },
    }
  }

  return {
    content: userInput,
    options: {
      ...DEFAULT_GET_RESPONSE_OPTIONS,
      temperature,
    },
  }
}

const chat = renderChat([])
const state = SessionState.load(STATE_FILE)
const sigint = new AbortController()

process.on('SIGINT', () => sigint.abort())

sigint.signal.addEventListener('abort', () => {
  readline.close()
  chat.unmount()
  // Report token savings once the UI has torn down. Write straight to fd 1:
  // Ink patches `console.log` while mounted, so a normal log would be swallowed
  // in the unmount/exit race. `writeSync` bypasses that and flushes before exit.
  writeSync(1, `\n${state.report()}\n`)
  process.exit(0)
})

const readline = createInterface({
  input: process.stdin,
  output: process.stdout,
})

// When stdin is a TTY, readline owns Ctrl+C — route it to the same abort path
// instead of letting it silently close the interface (which would otherwise
// leave `question()` rejecting on every subsequent loop iteration).
readline.on('SIGINT', () => sigint.abort())

// On EOF (Ctrl+D / end of piped input) a pending `question()` never settles,
// so hook 'close' to drive the same clean shutdown as `exit`.
readline.on('close', () => sigint.abort())

async function main() {
  const conversation = new ConversationService(new OpenAI(), state)

  while (!sigint.signal.aborted) {
    let userInput: string
    try {
      userInput = (await readline.question('> ', { signal: sigint.signal })).trim()
    } catch {
      // The prompt was aborted or the interface closed (Ctrl+C / Ctrl+D / EOF).
      // Stop reading rather than spinning on a dead readline.
      break
    }

    if (userInput === 'exit') {
      break
    }

    // Deterministic out-of-window state: pin a fact to disk without spending a
    // model turn. It's injected as a stable prefix on every later request.
    if (userInput.startsWith(REMEMBER_PREFIX)) {
      const fact = userInput.slice(REMEMBER_PREFIX.length).trim()
      if (fact) {
        state.addFact(fact)
        chat.push({ role: 'user', content: userInput })
        chat.push({ role: 'assistant', content: `📌 Remembered: ${fact}` })
      }
      continue
    }

    const { content, options } = resolveTurnOptions(userInput)
    if (!content) {
      continue
    }

    try {
      conversation.pushUserMessage(content)
      chat.push({ role: 'user', content })

      chat.setStreaming('')
      const assistantContent = await conversation.completeTurn(
        options,
        (delta) => {
          chat.appendStreaming(delta)
        },
      )
      chat.commitStreaming(assistantContent)
    } catch (error) {
      // Keep the REPL alive on turn-level failures (e.g. transient API errors).
      // Surface the error in the transcript instead of tearing down the UI.
      const message = error instanceof Error ? error.message : String(error)
      chat.commitStreaming(`⚠️ ${message}`)
    }
  }

  // Reached via `exit` or EOF; unmount and quit through the abort handler.
  sigint.abort()
}

main().catch(console.error)
