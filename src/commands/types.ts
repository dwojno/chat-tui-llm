import type { TurnOptions } from '../conversation/options'
import type { SessionState } from '../conversation/state'
import type { ChatHandle } from '../ui/chat'

/**
 * Ambient state a command may read or mutate. The REPL builds this once and
 * passes it to every command, so commands never reach for globals.
 */
export interface CommandContext {
  /** Temperature resolved from CLI flags at startup; applied to every turn. */
  temperature: number
  state: SessionState
  chat: ChatHandle
}

/**
 * What running a command tells the REPL to do next:
 * - `turn`    — send `content` to the model with `options` and stream the reply
 * - `handled` — the command did its own side effects; just read the next line
 * - `exit`    — stop the REPL
 */
export type CommandAction =
  | { kind: 'turn'; content: string; options: TurnOptions }
  | { kind: 'handled' }
  | { kind: 'exit' }

export interface Command {
  /** Identifier for help/debugging (e.g. the slash keyword). */
  name: string
  /**
   * Text inserted when this command is autocompleted, e.g. `'/json '`. Present
   * only for user-typeable slash commands; it also drives the `/` menu.
   */
  completion?: string
  /** One-line, user-facing description shown in the autocomplete menu. */
  hint?: string
  /** Whether this command claims the given raw input line. */
  matches(input: string): boolean
  /** Run the command, optionally via `ctx`, and say what happens next. */
  run(input: string, ctx: CommandContext): CommandAction | Promise<CommandAction>
}
