import { parseFileMentions, resolveMentionFile } from "../file-mentions";
import type { Command } from "./types";

const PREFIX = "/learn ";

export const learnCommand: Command = {
  name: "learn",
  completion: PREFIX,
  hint: "index @files for RAG (e.g. /learn @src/foo.ts)",
  matches: (input) => input === "/learn" || input.startsWith(PREFIX),
  run: async (input, { session, chat }) => {
    const body = input === "/learn" ? "" : input.slice(PREFIX.length).trim();
    const mentions = parseFileMentions(body);

    chat.push({ role: "user", content: input });

    if (!mentions.length) {
      chat.push({
        role: "assistant",
        content: "Usage: /learn @path/to/file [@another/file ...]",
      });
      return { kind: "handled" };
    }

    const valid: string[] = [];
    const missing: string[] = [];

    await Promise.all(
      mentions.map(async (path) => {
        const resolved = await resolveMentionFile(process.cwd(), path);
        if (resolved) valid.push(path);
        else missing.push(path);
      }),
    );

    const added = await session.addSources(valid);
    const alreadyIndexed = valid.filter((path) => !added.includes(path));

    const lines: string[] = [];
    if (added.length) {
      lines.push(`📚 Added ${added.length} source${added.length === 1 ? "" : "s"}:`);
      lines.push(...added.map((path) => `  - ${path}`));
    }
    if (alreadyIndexed.length) {
      lines.push(`Already indexed: ${alreadyIndexed.join(", ")}`);
    }
    if (missing.length) {
      lines.push(`Not found: ${missing.map((path) => `@${path}`).join(", ")}`);
    }
    if (!added.length && !alreadyIndexed.length && !missing.length) {
      lines.push("No sources were added.");
    }

    chat.push({ role: "assistant", content: lines.join("\n") });
    return { kind: "handled" };
  },
};
