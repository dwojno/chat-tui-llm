import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { runCommand } from '../commands/registry'
import type { CommandContext } from '../commands/types'
import type { ConversationService } from '../conversation/service'
import type { SessionState } from '../conversation/state'
import type { ChatHandle } from '../ui/chat'

export interface ReplDeps {
  chat: ChatHandle
  conversation: ConversationService
  state: SessionState
  temperature: number
}

/**
 * The read-eval-print loop: read a line, resolve it to a command, and either
 * run a model turn or apply the command's side effect. Owns readline setup and
 * the Ctrl+C / Ctrl+D / EOF shutdown path.
 */
export async function runRepl({
  chat,
  conversation,
  state,
  temperature,
}: ReplDeps): Promise<void> {
  const sigint = new AbortController()
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  process.on('SIGINT', () => sigint.abort())

  // When stdin is a TTY, readline owns Ctrl+C — route it to the same abort path
  // instead of letting it silently close the interface (which would otherwise
  // leave `question()` rejecting on every subsequent loop iteration).
  readline.on('SIGINT', () => sigint.abort())

  // On EOF (Ctrl+D / end of piped input) a pending `question()` never settles,
  // so hook 'close' to drive the same clean shutdown as `exit`.
  readline.on('close', () => sigint.abort())

  sigint.signal.addEventListener('abort', () => {
    readline.close()
    chat.unmount()
    // Report token savings once the UI has torn down. Write straight to fd 1:
    // Ink patches `console.log` while mounted, so a normal log would be swallowed
    // in the unmount/exit race. `writeSync` bypasses that and flushes before exit.
    writeSync(1, `\n${state.report()}\n`)
    process.exit(0)
  })

  const ctx: CommandContext = { temperature, state, chat }

  while (!sigint.signal.aborted) {
    let input: string
    try {
      input = (await readline.question('> ', { signal: sigint.signal })).trim()
    } catch {
      // The prompt was aborted or the interface closed (Ctrl+C / Ctrl+D / EOF).
      // Stop reading rather than spinning on a dead readline.
      break
    }

    const action = await runCommand(input, ctx)

    if (action.kind === 'exit') {
      break
    }
    if (action.kind === 'handled' || !action.content) {
      continue
    }

    try {
      conversation.pushUserMessage(action.content)
      chat.push({ role: 'user', content: action.content })

      chat.setStreaming('')
      const assistantContent = await conversation.completeTurn(
        action.options,
        (delta) => chat.appendStreaming(delta),
        (status) => chat.setStreaming(status),
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
