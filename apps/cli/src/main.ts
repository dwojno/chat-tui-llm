import { OpenAI } from "openai";
import type { z } from "zod";
import { Agent, EventBus, type ToolDefinition } from "@chat/agent";
import { parseCliArgs } from "@/platform/cli/args";
import { runRepl } from "@/app/input/repl";
import { buildChatContext } from "@/app/session/switch";
import { envConfig } from "@/platform/config";
import {
  DB_PATH,
  KEEP_LAST_TURNS,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
} from "@/platform/cli/config";
import { TEMPERATURE } from "@/app/config";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { createAgentTools } from "@/app/tools";
import { connectMcpServers, type McpConnection } from "@/app/tools/mcp";
import { Session } from "@/app/session/session";
import { createRagDeps, LocalStore, type OpenStoreOptions, type Store } from "@/store";
import { Model } from "@/platform/model";
import { traceToolExecution } from "@/platform/telemetry";
import { redactPII } from "@/platform/utils/redact";
import { renderChat } from "@/ui/chat";
import { messagesFromTranscript } from "@/ui/history";

export interface RunDeps {
  openai?: OpenAI;
  ragOpenai?: OpenAI;
  dbPath?: string;
  disableMcp?: boolean;
  extraTools?: ToolDefinition<z.ZodType>[];
}

async function connectProfileMcp(store: Store): Promise<McpConnection> {
  const stored = await store.mcp.list(store.profileId);
  return connectMcpServers(stored);
}

export async function run(deps: RunDeps = {}): Promise<void> {
  const interactive = process.stdin.isTTY === true;
  const cli = parseCliArgs();

  const openai =
    deps.openai ??
    new OpenAI({
      apiKey: envConfig.model.apiKey,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: OPENAI_TIMEOUT_MS,
    });
  const model = Model.fromOpenAI(openai);
  const openOpts: OpenStoreOptions = {
    rag: createRagDeps(deps.ragOpenai ?? openai, envConfig.rag),
  };
  if (cli.conversationId !== undefined) openOpts.conversationId = cli.conversationId;
  const store = await LocalStore.open(deps.dbPath ?? DB_PATH, openOpts);
  const mcp: McpConnection = !deps.disableMcp
    ? await connectProfileMcp(store)
    : { tools: [], close: async () => {} };
  const { tools, forkProfiles } = createAgentTools(store, mcp.tools, deps.extraTools);
  const bus = new EventBus();
  const agent = new Agent({
    model,
    temperature: TEMPERATURE,
    cacheKey: `chat-cli:${process.pid}`,
    instructions: SYSTEM_INSTRUCTIONS,
    tools,
    forkProfiles,
    traceToolExecution,
    ...(envConfig.security.redactPii ? { redact: redactPII } : {}),
  });
  const session = await Session.create(agent, model, store, KEEP_LAST_TURNS, bus);

  const chat = renderChat(messagesFromTranscript(await session.history()), {
    interactive,
    initialUsage: await session.getUsageTotals(),
    initialContext: await buildChatContext(store),
    conversationId: store.conversationId,
  });

  if (interactive && envConfig.security.approvalsEnabled) {
    session.setApprovalHandler((req) => chat.promptApproval(req));
    session.setClarificationHandler((req) => chat.promptClarification(req));
  }

  await runRepl({ chat, session, interactive, store, bus, onShutdown: mcp.close });
}
