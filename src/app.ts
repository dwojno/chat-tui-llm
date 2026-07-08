import { OpenAI } from "openai";
import { parseCliArgs } from "./cli/args";
import { runRepl } from "./cli/repl";
import { STATE_FILE } from "./config";
import { ConversationService } from "./conversation/service";
import { SessionState } from "./conversation/state";
import { mainTools } from "./tools";
import { renderChat } from "./ui/chat";

/**
 * Composition root: build every dependency once and hand them to the REPL.
 * Keeping wiring here (and out of the modules themselves) means the loop, the
 * commands, and the conversation service can all be driven with test doubles.
 */
export async function run(): Promise<void> {
  // A TTY lets the Ink prompt own stdin (raw-mode editing + autocomplete); when
  // input is piped we fall back to line-buffered readline.
  const interactive = process.stdin.isTTY === true;
  const state = SessionState.load(STATE_FILE);
  const chat = renderChat([], { interactive, initialUsage: state.usageTotals });
  const conversation = new ConversationService(new OpenAI(), state, {
    tools: mainTools,
  });
  const { temperature } = parseCliArgs();

  await runRepl({ chat, conversation, state, temperature, interactive });
}
