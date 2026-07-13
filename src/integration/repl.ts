import { writeSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { runCommand } from "./commands/registry";
import type { CommandContext } from "./commands/types";
import { expandFileMentions } from "./file-mentions";
import type { Session } from "./session";
import { buildChatContext } from "./switch";
import { buildExitMessage } from "./shutdown";
import { shutdownTelemetry } from "./telemetry/otel";
import type { Store } from "../store";
import type { ChatHandle } from "../ui/chat";
import { toolStepLabel } from "../ui/labels";

export interface ReplDeps {
  chat: ChatHandle;
  session: Session;
  store: Store;
  interactive: boolean;
}

export async function processLine(
  input: string,
  ctx: CommandContext,
  chat: ChatHandle,
  session: Session,
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

    const expanded = await expandFileMentions(action.content);
    chat.setStreaming("");
    for await (const event of session.runTurn(expanded, action.options)) {
      switch (event.type) {
        case "delta":
          chat.appendStreaming(event.text);
          break;
        case "tool":
          chat.addStep({
            label: event.label ?? toolStepLabel(event.name),
            detail: event.detail,
            fork: event.fork,
          });
          void session.getUsageTotals().then((usage) => chat.setUsage(usage));
          break;
        case "status":
          chat.addStep({ label: event.text, fork: event.fork });
          void session.getUsageTotals().then((usage) => chat.setUsage(usage));
          break;
        case "answer":
          chat.commitStreaming(event.content);
          void session.getUsageTotals().then((usage) => chat.setUsage(usage));
          void buildChatContext(session.store).then((context) => chat.setContext(context));
          break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    chat.commitStreaming(`⚠️ ${message}`);
  }
  return "continue";
}

export async function runRepl({ chat, session, store, interactive }: ReplDeps): Promise<void> {
  const sigint = new AbortController();

  const shutdown = (): void => {
    if (!sigint.signal.aborted) sigint.abort();
  };

  sigint.signal.addEventListener("abort", () => {
    chat.unmount();
    void buildExitMessage(store, session).then(async (message) => {
      writeSync(1, message);
      await shutdownTelemetry();
      process.exit(0);
    });
  });

  process.on("SIGINT", shutdown);

  const ctx: CommandContext = { session, chat };

  chat.setUsage(await session.getUsageTotals());

  if (interactive) {
    chat.onExit(shutdown);
    while (!sigint.signal.aborted) {
      const input = (await chat.question()).trim();
      if ((await processLine(input, ctx, chat, session)) === "exit") break;
    }
  } else {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readline.on("close", shutdown);

    while (!sigint.signal.aborted) {
      let input: string;
      try {
        input = (await readline.question("> ", { signal: sigint.signal })).trim();
      } catch {
        break;
      }
      if ((await processLine(input, ctx, chat, session)) === "exit") break;
    }
  }

  shutdown();
}
