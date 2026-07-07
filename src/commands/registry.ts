import { DEFAULT_TURN_OPTIONS } from '../conversation/options'
import { exitCommand } from './exit'
import { jsonCommand } from './json'
import { rememberCommand } from './remember'
import { structuredCommand } from './structured'
import type { Command, CommandAction, CommandContext } from './types'

/**
 * Every slash/keyword command, in match order. To add a command, write a
 * {@link Command} module and drop it in here — nothing else needs to change.
 * Prefix commands are mutually exclusive, so order only matters for the exact
 * `exit` match ahead of the catch-all below.
 */
const COMMANDS: Command[] = [
  exitCommand,
  rememberCommand,
  structuredCommand,
  jsonCommand,
]

/** Fallback for any plain line: a default streaming chat turn. */
const chatCommand: Command = {
  name: 'chat',
  matches: () => true,
  run: (input, { temperature }) => ({
    kind: 'turn',
    content: input,
    options: { ...DEFAULT_TURN_OPTIONS, temperature },
  }),
}

/** Resolve a raw input line to the command that will handle it. */
export function resolveCommand(input: string): Command {
  return COMMANDS.find((command) => command.matches(input)) ?? chatCommand
}

/** Resolve and run the command for `input`, returning the next REPL action. */
export function runCommand(
  input: string,
  ctx: CommandContext,
): CommandAction | Promise<CommandAction> {
  return resolveCommand(input).run(input, ctx)
}
