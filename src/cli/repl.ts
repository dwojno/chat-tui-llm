import { writeSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { runCommand } from "../commands/registry";
import type { CommandContext } from "../commands/types";
import type { ConversationService } from "../conversation/service";
import type { SessionState } from "../conversation/state";
import type { ChatHandle } from "../ui/chat";
import { toolStepLabel } from "../ui/labels";

export interface ReplDeps {
  chat: ChatHandle;
  conversation: ConversationService;
  state: SessionState;
  temperature: number;
  /** True when stdin is a TTY and the Ink prompt drives input directly. */
  interactive: boolean;
}

/**
 * Run one input line: resolve it to a command and either run a model turn or
 * apply the command's side effect. Returns `'exit'` when the loop should stop.
 */
export async function processLine(
  input: string,
  ctx: CommandContext,
  chat: ChatHandle,
  conversation: ConversationService,
): Promise<"exit" | "continue"> {
  const action = await runCommand(input, ctx);

  if (action.kind === "exit") {
    return "exit";
  }
  if (action.kind === "handled" || !action.content) {
    return "continue";
  }

  try {
    chat.push({ role: "user", content: action.content });

    chat.setStreaming("");
    for await (const event of conversation.run(action.content, action.options)) {
      switch (event.type) {
        case "delta":
          chat.appendStreaming(event.text);
          break;
        case "tool":
          chat.addStep({
            label: toolStepLabel(event.name),
            detail: event.detail,
            fork: event.fork,
          });
          break;
        case "status":
          chat.addStep({ label: event.text, fork: event.fork });
          break;
        case "answer":
          chat.commitStreaming(event.content);
          break;
      }
    }
  } catch (error) {
    // Keep the REPL alive on turn-level failures (e.g. transient API errors).
    // Surface the error in the transcript instead of tearing down the UI.
    const message = error instanceof Error ? error.message : String(error);
    chat.commitStreaming(`⚠️ ${message}`);
  }
  return "continue";
}

/**
 * The read-eval-print loop. In interactive mode the Ink prompt owns input and
 * Ctrl+C / Ctrl+D; when stdin is piped we fall back to line-buffered readline.
 * Owns the clean shutdown path either way.
 */
export async function runRepl({
  chat,
  conversation,
  state,
  temperature,
  interactive,
}: ReplDeps): Promise<void> {
  const sigint = new AbortController();

  const shutdown = (): void => {
    if (!sigint.signal.aborted) sigint.abort();
  };

  sigint.signal.addEventListener("abort", () => {
    chat.unmount();
    // Report token savings once the UI has torn down. Write straight to fd 1:
    // Ink patches `console.log` while mounted, so a normal log would be swallowed
    // in the unmount/exit race. `writeSync` bypasses that and flushes before exit.
    writeSync(1, `\n${state.report()}\n`);
    process.exit(0);
  });

  // Backstop for an external SIGINT (e.g. `kill -INT`); in interactive mode the
  // terminal's own Ctrl+C is delivered through the Ink prompt's `onExit`.
  process.on("SIGINT", shutdown);

  const ctx: CommandContext = { temperature, state, chat };

  if (interactive) {
    chat.onExit(shutdown);
    while (!sigint.signal.aborted) {
      const input = (await chat.question()).trim();
      if ((await processLine(input, ctx, chat, conversation)) === "exit") break;
    }
  } else {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    // On EOF (Ctrl+D / end of piped input) a pending `question()` never settles,
    // so hook 'close' to drive the same clean shutdown.
    readline.on("close", shutdown);

    while (!sigint.signal.aborted) {
      let input: string;
      try {
        input = (await readline.question("> ", { signal: sigint.signal })).trim();
      } catch {
        // The prompt was aborted or the interface closed (Ctrl+C / Ctrl+D / EOF).
        break;
      }
      if ((await processLine(input, ctx, chat, conversation)) === "exit") break;
    }
  }

  // Reached via `exit` or EOF; unmount and quit through the abort handler.
  shutdown();
}
