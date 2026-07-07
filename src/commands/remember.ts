import type { Command } from "./types";

const PREFIX = "/remember ";

/**
 * `/remember <fact>` — pin a fact to disk without spending a model turn. It's
 * injected as a stable prefix on every later request (see the conversation
 * service's context block), so it survives out-of-window truncation.
 */
export const rememberCommand: Command = {
  name: "remember",
  completion: PREFIX,
  hint: "pin a fact to long-term memory",
  matches: (input) => input.startsWith(PREFIX),
  run: (input, { state, chat }) => {
    const fact = input.slice(PREFIX.length).trim();
    if (fact) {
      state.addFact(fact);
      chat.push({ role: "user", content: input });
      chat.push({ role: "assistant", content: `📌 Remembered: ${fact}` });
    }
    return { kind: "handled" };
  },
};
