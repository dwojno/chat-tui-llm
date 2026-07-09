import { z } from "zod";
import type { TurnEvent } from "../../agent/events";
import type { ToolDefinition } from "../../agent/tools/types";
import type { GrepMatch, GrepOptions, ReadRange, Store } from "../../store";

/**
 * Store-backed RAG tools, composed here at the integration level and injected
 * into the agent. Each closes over the live `Store` and calls `store.sources.*`
 * with the active profile. The agent core knows nothing about RAG.
 */
export function createRagTools(store: Store): ToolDefinition<z.ZodType>[] {
  const searchParams = z.object({
    query: z.string().min(1).describe("Natural-language question to search the knowledge base for"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .nullable()
      .describe(
        "Max passages to return; null uses the default, which is enough for most " +
          "questions. Only raise it when the top results clearly miss the answer — " +
          "a larger limit returns more off-topic passages.",
      ),
  });
  const searchTool: ToolDefinition<typeof searchParams> = {
    name: "search_knowledge_base",
    label: "Searching knowledge base",
    description:
      "Hybrid (dense + sparse, RRF-fused) semantic search over the current " +
      "profile's indexed source files, reranked to the most relevant passages. " +
      "Returns the best-matching passages with their file path and line range — " +
      "cite these to the user. Use a focused query naming the specific concept or " +
      "entity you need, not the user's whole sentence; prefer one precise search " +
      "over several broad ones. If a passage looks right but is cut off, expand it " +
      "with read_file rather than searching again.",
    parameters: searchParams,
    async *execute({ query, limit }): AsyncGenerator<TurnEvent, string> {
      const hits = await store.sources.search(
        store.profileId,
        query,
        limit !== null ? { limit } : {},
      );
      if (!hits.length) return `No results for "${query}".`;
      return hits
        .map(
          (hit) =>
            `${hit.path}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(3)})\n${hit.snippet}`,
        )
        .join("\n\n");
    },
    summarize: ({ query }) => query,
  };

  const listParams = z.object({});
  const listTool: ToolDefinition<typeof listParams> = {
    name: "list_files",
    label: "Listing knowledge base files",
    description: "List the source files indexed in the current profile's knowledge base.",
    parameters: listParams,
    async *execute(): AsyncGenerator<TurnEvent, string> {
      const files = await store.sources.listFiles(store.profileId);
      return files.length
        ? ["Indexed files:", ...files.map((file) => `  - ${file}`)].join("\n")
        : "No files indexed yet. Use /learn @file to add one.";
    },
  };

  const grepParams = z.object({
    pattern: z.string().min(1).describe("Regular expression to match against each line"),
    paths: z
      .array(z.string())
      .nullable()
      .describe("Restrict to these indexed file paths (null for all)"),
    ignoreCase: z.boolean().nullable().describe("Case-insensitive match (null = case-sensitive)"),
    maxMatches: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .nullable()
      .describe("Cap on matches (null = 200)"),
  });
  const grepTool: ToolDefinition<typeof grepParams> = {
    name: "grep_files",
    label: "Grepping knowledge base",
    description:
      "Regex-search the raw text of indexed files (streamed from object storage), " +
      "returning matching lines as `path:line: text`. Use this for exact strings, " +
      "identifiers, or error messages; use search_knowledge_base for conceptual questions.",
    parameters: grepParams,
    async *execute({ pattern, paths, ignoreCase, maxMatches }): AsyncGenerator<TurnEvent, string> {
      yield { type: "status", text: `grep /${pattern}/` };
      const opts: GrepOptions = {
        ...(paths !== null ? { paths } : {}),
        ...(ignoreCase !== null ? { ignoreCase } : {}),
        ...(maxMatches !== null ? { maxMatches } : {}),
      };
      // Stream matches to the UI as they are found (facade yields them lazily).
      const matches: GrepMatch[] = [];
      for await (const match of store.sources.grep(store.profileId, pattern, opts)) {
        matches.push(match);
        yield { type: "status", text: `${match.path}:${match.line}` };
      }
      if (!matches.length) return `No matches for /${pattern}/.`;
      return matches.map((match) => `${match.path}:${match.line}: ${match.text.trim()}`).join("\n");
    },
    summarize: ({ pattern }) => pattern,
  };

  const readParams = z.object({
    path: z.string().min(1).describe("Indexed source file path"),
    mode: z.enum(["lines", "bytes"]).describe("Read a line range or a byte range"),
    start: z.number().int().min(0).describe("1-based start line, or start byte offset"),
    end: z.number().int().min(0).describe("Inclusive end line, or end byte offset"),
  });
  const readTool: ToolDefinition<typeof readParams> = {
    name: "read_file",
    label: "Reading knowledge base file",
    description:
      "Read a slice of an indexed file (converted Markdown) from object storage — " +
      "either a line range (mode=lines) or a byte range (mode=bytes).",
    parameters: readParams,
    async *execute({ path, mode, start, end }): AsyncGenerator<TurnEvent, string> {
      const range: ReadRange =
        mode === "bytes" ? { kind: "bytes", start, end } : { kind: "lines", start, end };
      const content = await store.sources.readFile(store.profileId, path, range);
      return content || "(empty range)";
    },
    summarize: ({ path }) => path,
  };

  return [searchTool, listTool, grepTool, readTool];
}
