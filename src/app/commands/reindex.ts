import { drain } from "@/platform/utils/async-gen";
import type { Command } from "./types";

const COMMAND = "/reindex";

export const reindexCommand: Command = {
  name: "reindex",
  completion: COMMAND,
  hint: "re-index all sources for this profile",
  matches: (input) => input.trim() === COMMAND,
  run: async (input, { session, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const results = await drain(session.reindexSources());
    if (!results.length) {
      chat.push({ role: "assistant", content: "No sources to re-index. Use /learn @file first." });
      return { kind: "handled" };
    }

    const indexed = results.filter((result) => result.status === "indexed");
    const failed = results.filter((result) => result.status === "error");

    const lines = [`🔄 Re-indexed ${indexed.length}/${results.length} source(s).`];
    if (failed.length) {
      lines.push(...failed.map((result) => `  - ${result.path}: ${result.error ?? "error"}`));
    }
    chat.push({ role: "assistant", content: lines.join("\n") });
    return { kind: "handled" };
  },
};
