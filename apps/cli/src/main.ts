import { OpenAI } from "openai";
import type { z } from "zod";
import { Agent, EventBus, type ToolDefinition } from "@chat/agent";
import { parseCliArgs } from "@/args";
import { runRepl } from "@/input/repl";
import { buildChatContext } from "@/session/switch";
import {
  DB_PATH,
  FORK_MODEL,
  HANDOFF_MODEL,
  KEEP_LAST_TURNS,
  loadConfig,
  OPENAI_MAX_RETRIES,
  OPENAI_TIMEOUT_MS,
  TEMPERATURE,
} from "@/config";
import { SYSTEM_INSTRUCTIONS } from "@/prompts";
import { createAgentTools } from "@chat/tools";
import { connectMcpServers, type McpConnection } from "@chat/tools/mcp";
import { Session } from "@/session/session";
import { createRagDeps, LocalStore, type OpenStoreOptions, type Store } from "@/backend";
import { Model } from "@chat/platform/model";
import { traceToolExecution } from "@chat/platform/telemetry";
import { redactPII } from "@chat/platform/utils/redact";
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
  const envConfig = loadConfig();

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
  const { tools, forkProfiles } = createAgentTools({
    store,
    forkModel: FORK_MODEL,
    handoffModel: HANDOFF_MODEL,
    webSearch: {
      maxResults: envConfig.tools.webSearch.maxResults,
      ...(envConfig.tools.webSearch.tavilyApiKey
        ? { tavilyApiKey: envConfig.tools.webSearch.tavilyApiKey }
        : {}),
    },
    mcpTools: mcp.tools,
    ...(deps.extraTools ? { extraTools: deps.extraTools } : {}),
  });
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
