import type { TurnOptions } from "@chat/agent/conversation/options";
import type { Session } from "@/app/session/session";
import type { Store } from "@/store";
import type { ChatHandle } from "@/ui/chat";

export interface CommandContext {
  session: Session;
  chat: ChatHandle;
  store: Store;
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
