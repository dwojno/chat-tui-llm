import type { TurnOptions } from "../../agent/conversation/options";
import type { Session } from "../session";
import type { ChatHandle } from "../../ui/chat";

export interface CommandContext {
  session: Session;
  chat: ChatHandle;
}

export type CommandAction =
  | { kind: "turn"; content: string; options: TurnOptions }
  | { kind: "handled" }
  | { kind: "exit" };

export interface Command {
  name: string;
  completion?: string;
  hint?: string;
  matches(input: string): boolean;
  run(input: string, ctx: CommandContext): CommandAction | Promise<CommandAction>;
}
