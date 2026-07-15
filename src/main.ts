import { OpenAI } from "openai";
import { parseCliArgs } from "@/platform/cli/args";
import { runRepl } from "@/app/input/repl";
import { buildChatContext } from "@/app/session/switch";
import { approvalsEnabled } from "@/platform/cli/env";
import {
  DB_PATH,
  KEEP_LAST_TURNS,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
} from "@/platform/cli/config";
import { Agent } from "@/agent/agent";
import { EventBus } from "@/agent/events/bus";
import { TEMPERATURE } from "@/app/config";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { createAgentTools } from "@/app/tools";
import { Session } from "@/app/session/session";
import { createRagDeps, loadRagConfig, LocalStore, type OpenStoreOptions } from "@/store";
import { renderChat } from "@/ui/chat";
import { messagesFromTranscript } from "@/ui/history";

export async function run(): Promise<void> {
  const interactive = process.stdin.isTTY === true;
  const cli = parseCliArgs();

  const openai = new OpenAI({ maxRetries: OPENAI_MAX_RETRIES, timeout: OPENAI_TIMEOUT_MS });
  const openOpts: OpenStoreOptions = {
    rag: createRagDeps(openai, loadRagConfig()),
  };
  if (cli.conversationId !== undefined) openOpts.conversationId = cli.conversationId;
  const store = await LocalStore.open(DB_PATH, openOpts);
  const { tools, forkProfiles } = createAgentTools(store);
  const bus = new EventBus();
  const agent = new Agent({
    openai,
    temperature: TEMPERATURE,
    cacheKey: `chat-cli:${process.pid}`,
    instructions: SYSTEM_INSTRUCTIONS,
    tools,
    forkProfiles,
  });
  const session = await Session.create(agent, openai, store, KEEP_LAST_TURNS, bus);

  const chat = renderChat(messagesFromTranscript(await session.history()), {
    interactive,
    initialUsage: await session.getUsageTotals(),
    initialContext: await buildChatContext(store),
    conversationId: store.conversationId,
  });

  if (interactive && approvalsEnabled()) {
    session.setApprovalHandler((req) => chat.promptApproval(req));
    session.setClarificationHandler((req) => chat.promptClarification(req));
  }

  await runRepl({ chat, session, interactive, store, bus });
}
