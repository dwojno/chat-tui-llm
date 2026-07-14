import type { Command } from "./types";

const PREFIX = "/remember ";

export const rememberCommand: Command = {
  name: "remember",
  completion: PREFIX,
  hint: "pin a memory to long-term storage",
  matches: (input) => input.startsWith(PREFIX),
  run: async (input, { session, chat }) => {
    const memory = input.slice(PREFIX.length).trim();
    if (memory) {
      await session.addMemory(memory);
      chat.push({ role: "user", content: input });
      chat.push({ role: "assistant", content: `📌 Remembered: ${memory}` });
    }
    return { kind: "handled" };
  },
};
