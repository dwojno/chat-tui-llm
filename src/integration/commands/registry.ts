import { DEFAULT_TURN_OPTIONS } from "../../agent/conversation/options";
import { exitCommand } from "./exit";
import { jsonCommand } from "./json";
import { learnCommand } from "./learn";
import { rememberCommand } from "./remember";
import { sourcesCommand } from "./sources";
import { structuredCommand } from "./structured";
import type { Command, CommandAction, CommandContext } from "./types";

const COMMANDS: Command[] = [
  exitCommand,
  rememberCommand,
  learnCommand,
  sourcesCommand,
  structuredCommand,
  jsonCommand,
];

const chatCommand: Command = {
  name: "chat",
  matches: () => true,
  run: (input, { temperature }) => ({
    kind: "turn",
    content: input,
    options: { ...DEFAULT_TURN_OPTIONS, temperature },
  }),
};

export interface SlashCommandInfo {
  completion: string;
  hint: string;
}

export function slashCommandCatalog(): SlashCommandInfo[] {
  return COMMANDS.filter(
    (command): command is Command & { completion: string } =>
      command.completion?.startsWith("/") ?? false,
  ).map((command) => ({
    completion: command.completion,
    hint: command.hint ?? "",
  }));
}

export function resolveCommand(input: string): Command {
  return COMMANDS.find((command) => command.matches(input)) ?? chatCommand;
}

export function runCommand(
  input: string,
  ctx: CommandContext,
): CommandAction | Promise<CommandAction> {
  return resolveCommand(input).run(input, ctx);
}
