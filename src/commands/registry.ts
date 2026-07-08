import { DEFAULT_TURN_OPTIONS } from "../conversation/options";
import { exitCommand } from "./exit";
import { jsonCommand } from "./json";
import { learnCommand } from "./learn";
import { rememberCommand } from "./remember";
import { sourcesCommand } from "./sources";
import { structuredCommand } from "./structured";
import type { Command, CommandAction, CommandContext } from "./types";

/**
 * Every slash/keyword command, in match order. To add a command, write a
 * {@link Command} module and drop it in here — nothing else needs to change.
 * Prefix commands are mutually exclusive, so order only matters for the exact
 * `exit` match ahead of the catch-all below.
 */
const COMMANDS: Command[] = [
  exitCommand,
  rememberCommand,
  learnCommand,
  sourcesCommand,
  structuredCommand,
  jsonCommand,
];

/** Fallback for any plain line: a default streaming chat turn. */
const chatCommand: Command = {
  name: "chat",
  matches: () => true,
  run: (input, { temperature }) => ({
    kind: "turn",
    content: input,
    options: { ...DEFAULT_TURN_OPTIONS, temperature },
  }),
};

/** A user-typeable slash command, surfaced to the `/` autocomplete menu. */
export interface SlashCommandInfo {
  /** Text to insert on completion, e.g. `'/json '`. */
  completion: string;
  /** One-line description shown beside it. */
  hint: string;
}

/**
 * The slash commands offered by the input's `/` autocomplete, in match order.
 * Sourced from the registry so the menu never drifts from what actually runs.
 */
export function slashCommandCatalog(): SlashCommandInfo[] {
  return COMMANDS.filter(
    (command): command is Command & { completion: string } =>
      command.completion?.startsWith("/") ?? false,
  ).map((command) => ({
    completion: command.completion,
    hint: command.hint ?? "",
  }));
}

/** Resolve a raw input line to the command that will handle it. */
export function resolveCommand(input: string): Command {
  return COMMANDS.find((command) => command.matches(input)) ?? chatCommand;
}

/** Resolve and run the command for `input`, returning the next REPL action. */
export function runCommand(
  input: string,
  ctx: CommandContext,
): CommandAction | Promise<CommandAction> {
  return resolveCommand(input).run(input, ctx);
}
