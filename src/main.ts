import { OpenAI } from "openai";
import { parseCliArgs } from "./integration/args";
import { runRepl } from "./integration/repl";
import { DB_PATH, KEEP_LAST_TURNS } from "./integration/config";
import { AgentService } from "./agent/agent";
import { mainTools } from "./agent/tools";
import { Session } from "./integration/session";
import { LocalStore } from "./store/store";
import { renderChat } from "./ui/chat";
import { messagesFromTranscript } from "./ui/history";

export async function run(): Promise<void> {
  const interactive = process.stdin.isTTY === true;

  const openai = new OpenAI();
  const store = await LocalStore.open(DB_PATH);
  const agent = new AgentService(openai, {
    tools: mainTools,
    cacheKey: `chat-cli:${process.pid}`,
  });
  const session = await Session.create(agent, openai, store, KEEP_LAST_TURNS);

  const chat = renderChat(messagesFromTranscript(await session.history()), {
    interactive,
    initialUsage: await session.getUsageTotals(),
  });
  const { temperature } = parseCliArgs();

  await runRepl({ chat, session, temperature, interactive });
}
