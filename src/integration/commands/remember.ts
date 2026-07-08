import type { Command } from "./types";

const PREFIX = "/remember ";

export const rememberCommand: Command = {
  name: "remember",
  completion: PREFIX,
  hint: "pin a fact to long-term memory",
  matches: (input) => input.startsWith(PREFIX),
  run: (input, { session, chat }) => {
    const fact = input.slice(PREFIX.length).trim();
    if (fact) {
      session.addFact(fact);
      chat.push({ role: "user", content: input });
      chat.push({ role: "assistant", content: `📌 Remembered: ${fact}` });
    }
    return { kind: "handled" };
  },
};
