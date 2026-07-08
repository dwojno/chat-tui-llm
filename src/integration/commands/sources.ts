import type { Command } from "./types";

const COMMAND = "/sources";

export const sourcesCommand: Command = {
  name: "sources",
  completion: COMMAND,
  hint: "list indexed RAG source files",
  matches: (input) => input.trim() === COMMAND,
  run: (input, { session, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const content =
      session.sources.length === 0
        ? "No sources indexed yet. Use /learn @file to add one."
        : ["Indexed sources:", ...session.sources.map((path) => `  - ${path}`)].join("\n");

    chat.push({ role: "assistant", content });
    return { kind: "handled" };
  },
};
