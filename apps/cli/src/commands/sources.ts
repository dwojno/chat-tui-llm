import type { Command } from "./types";

const COMMAND = "/sources";

export const sourcesCommand: Command = {
  name: "sources",
  completion: COMMAND,
  hint: "list indexed RAG source files",
  matches: (input) => input.trim() === COMMAND,
  run: async (input, { session, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const paths = await session.sources();
    const content =
      paths.length === 0
        ? "No sources indexed yet. Use /learn @file to add one."
        : ["Indexed sources:", ...paths.map((path) => `  - ${path}`)].join("\n");

    chat.push({ role: "assistant", content });
    return { kind: "handled" };
  },
};
