import { z } from "zod";
import type { ToolRunContext } from "../agent/conversation/turn";
import type { ToolDefinition } from "../agent/tools/types";
import type { GrepMatch, GrepOptions, Store } from "../store";

export const GREP_FILES_NAME = "grep_files" as const;

const parameters = z.object({
  pattern: z.string().min(1).describe("Regular expression to match against each line"),
  paths: z
    .array(z.string())
    .nullable()
    .describe("Restrict to these indexed file paths (null for all)"),
  ignoreCase: z.boolean().nullable().describe("Case-insensitive match (null = case-sensitive)"),
  maxMatches: z.number().int().min(1).max(1000).nullable().describe("Cap on matches (null = 200)"),
});

/** Regex-search the raw text of indexed files, streaming matches as they land. */
export function createGrepFilesTool(store: Store): ToolDefinition<typeof parameters> {
  return {
    name: GREP_FILES_NAME,
    label: "Grepping knowledge base",
    description:
      "Regex-search the raw text of indexed files, returning matching lines as " +
      "`path:line: text`. Use this for exact strings, identifiers, or error " +
      "messages; use search_knowledge_base for conceptual questions.",
    parameters,
    async execute(
      { pattern, paths, ignoreCase, maxMatches },
      ctx?: ToolRunContext,
    ): Promise<string> {
      ctx?.bus.emit({ type: "status", text: `grep /${pattern}/` });
      const opts: GrepOptions = {
        ...(paths !== null ? { paths } : {}),
        ...(ignoreCase !== null ? { ignoreCase } : {}),
        ...(maxMatches !== null ? { maxMatches } : {}),
      };
      const matches: GrepMatch[] = [];
      for await (const match of store.sources.grep(store.profileId, pattern, opts)) {
        matches.push(match);
        ctx?.bus.emit({ type: "status", text: `${match.path}:${match.line}` });
      }
      if (!matches.length) return `No matches for /${pattern}/.`;
      return matches.map((match) => `${match.path}:${match.line}: ${match.text.trim()}`).join("\n");
    },
    summarize: ({ pattern }) => pattern,
  };
}
