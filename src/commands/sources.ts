import type { Command } from "./types";

const COMMAND = "/sources";

/**
 * `/sources` — list cwd-relative files registered via `/learn` for RAG.
 */
export const sourcesCommand: Command = {
  name: "sources",
  completion: COMMAND,
  hint: "list indexed RAG source files",
  matches: (input) => input.trim() === COMMAND,
  run: (input, { state, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const content =
      state.sources.length === 0
        ? "No sources indexed yet. Use /learn @file to add one."
        : ["Indexed sources:", ...state.sources.map((path) => `  - ${path}`)].join("\n");

    chat.push({ role: "assistant", content });
    return { kind: "handled" };
  },
};
