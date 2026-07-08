import { OpenAI } from "openai";
import { parseCliArgs } from "./integration/args";
import { runRepl } from "./integration/repl";
import { KEEP_LAST_TURNS, STATE_FILE } from "./integration/config";
import { AgentService } from "./agent/agent";
import { mainTools } from "./agent/tools";
import { Session } from "./integration/session";
import { FileConversationStore } from "./integration/store/file-store";
import { renderChat } from "./ui/chat";

export async function run(): Promise<void> {
  const interactive = process.stdin.isTTY === true;

  const openai = new OpenAI();
  const store = new FileConversationStore(STATE_FILE);
  const agent = new AgentService(openai, {
    tools: mainTools,
    cacheKey: `chat-cli:${process.pid}`,
  });
  const session = new Session(agent, openai, store, KEEP_LAST_TURNS);

  const chat = renderChat([], {
    interactive,
    initialUsage: session.usageTotals,
  });
  const { temperature } = parseCliArgs();

  await runRepl({ chat, session, temperature, interactive });
}
