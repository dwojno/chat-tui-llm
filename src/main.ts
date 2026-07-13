import { OpenAI } from "openai";
import { parseCliArgs } from "./integration/args";
import { runRepl } from "./integration/repl";
import { buildChatContext } from "./integration/switch";
import { approvalsEnabled } from "./integration/env";
import {
  DB_PATH,
  KEEP_LAST_TURNS,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
} from "./integration/config";
import { AgentService } from "./agent/agent";
import { createAgentTools } from "./integration/tools";
import { Session } from "./integration/session";
import { createRagDeps, loadRagConfig, LocalStore, type OpenStoreOptions } from "./store";
import { renderChat } from "./ui/chat";
import { messagesFromTranscript } from "./ui/history";

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
  const agent = new AgentService(openai, {
    tools,
    forkProfiles,
    cacheKey: `chat-cli:${process.pid}`,
  });
  const session = await Session.create(agent, openai, store, KEEP_LAST_TURNS);

  const chat = renderChat(messagesFromTranscript(await session.history()), {
    interactive,
    initialUsage: await session.getUsageTotals(),
    initialContext: await buildChatContext(store),
    conversationId: store.conversationId,
  });

  if (interactive && approvalsEnabled()) {
    session.setApprovalHandler((req) => chat.promptApproval(req));
  }

  await runRepl({ chat, session, interactive, store });
}
