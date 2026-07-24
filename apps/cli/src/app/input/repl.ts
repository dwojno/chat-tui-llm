import { writeSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import type { EventBus } from "@chat/agent/events/bus";
import { runCommand } from "@/app/commands/registry";
import type { CommandContext } from "@/app/commands/types";
import { resolveFileMentions } from "./file-mentions";
import type { Session } from "@/app/session/session";
import { buildChatContext } from "@/app/session/switch";
import { buildExitMessage } from "@/platform/cli/shutdown";
import { shutdownTelemetry } from "@/platform/telemetry/otel";
import type { Store } from "@/store";
import type { ChatHandle } from "@/ui/chat";
import { toolStepLabel } from "@/ui/labels";

export interface ReplDeps {
  chat: ChatHandle;
  session: Session;
  store: Store;
  bus: EventBus;
  interactive: boolean;
  onShutdown?: () => Promise<void>;
}

function subscribeChat(bus: EventBus, chat: ChatHandle, session: Session): () => void {
  const refreshUsage = (): void =>
    void session.getUsageTotals().then((usage) => chat.setUsage(usage));
  return bus.subscribe((event) => {
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
        refreshUsage();
        break;
      case "status":
        chat.addStep({ label: event.text, fork: event.fork });
        refreshUsage();
        break;
      case "scratchpad":
        chat.setScratchpad(event.sections);
        break;
      case "approval_request":
        chat.addStep({ label: `Awaiting approval — ${event.label ?? event.toolName}` });
        break;
      case "approval_resolved":
        chat.addStep({ label: event.outcome === "reject" ? "Rejected" : "Approved" });
        break;
    }
  });
}

export async function processLine(
  input: string,
  ctx: CommandContext,
  chat: ChatHandle,
  session: Session,
  bus: EventBus,
): Promise<"exit" | "continue"> {
  const action = await runCommand(input, ctx);

  if (action.kind === "exit") {
    return "exit";
  }
  if (action.kind === "handled" || !action.content) {
    return "continue";
  }

  chat.push({ role: "user", content: action.content });
  chat.setStreaming("");
  const unsubscribe = subscribeChat(bus, chat, session);
  try {
    const expanded = await resolveFileMentions(action.content);
    const answer = await session.runTurn(expanded, action.options);
    chat.commitStreaming(answer);
    void session.getUsageTotals().then((usage) => chat.setUsage(usage));
    void buildChatContext(session.store).then((context) => chat.setContext(context));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    chat.commitStreaming(`⚠️ ${message}`);
  } finally {
    unsubscribe();
  }
  return "continue";
}

export async function runRepl({
  chat,
  session,
  store,
  bus,
  interactive,
  onShutdown,
}: ReplDeps): Promise<void> {
  const sigint = new AbortController();

  const shutdown = (): void => {
    if (!sigint.signal.aborted) sigint.abort();
  };

  sigint.signal.addEventListener("abort", () => {
    chat.unmount();
    void buildExitMessage(store, session).then(async (message) => {
      writeSync(1, message);
      await onShutdown?.();
      await shutdownTelemetry();
      process.exit(0);
    });
  });

  process.on("SIGINT", shutdown);

  const ctx: CommandContext = { session, chat, store };

  chat.setUsage(await session.getUsageTotals());

  if (interactive) {
    chat.onExit(shutdown);
    while (!sigint.signal.aborted) {
      const input = (await chat.question()).trim();
      if ((await processLine(input, ctx, chat, session, bus)) === "exit") break;
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
      if ((await processLine(input, ctx, chat, session, bus)) === "exit") break;
    }
  }

  shutdown();
}
