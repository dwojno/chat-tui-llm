import { parseFileMentions, resolveMentionFile } from "../file-mentions";
import { drain } from "../../utils/async-gen";
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

    const results = [];
    for (const path of valid) {
      results.push(await drain(session.indexSource(path)));
    }
    const indexed = results.filter((result) => result.status === "indexed");
    const failed = results.filter((result) => result.status === "error");

    const lines: string[] = [];
    if (indexed.length) {
      lines.push(`📚 Indexed ${indexed.length} source${indexed.length === 1 ? "" : "s"}:`);
      lines.push(...indexed.map((result) => `  - ${result.path} (${result.chunkCount} chunks)`));
    }
    if (failed.length) {
      lines.push("Failed to index:");
      lines.push(
        ...failed.map((result) => `  - ${result.path}: ${result.error ?? "unknown error"}`),
      );
    }
    if (missing.length) {
      lines.push(`Not found: ${missing.map((path) => `@${path}`).join(", ")}`);
    }
    if (!lines.length) {
      lines.push("No sources were added.");
    }

    chat.push({ role: "assistant", content: lines.join("\n") });
    return { kind: "handled" };
  },
};
