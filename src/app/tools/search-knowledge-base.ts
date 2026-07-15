import { z } from "zod";
import type { ToolDefinition } from "@/agent/tools/types";
import type { Store } from "@/store";

export const SEARCH_KNOWLEDGE_BASE_NAME = "search_knowledge_base" as const;

/** Preview cap per hit — enough to judge relevance, not to answer from. */
const PREVIEW_CHARS = 200;

const parameters = z.object({
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

function preview(snippet: string): string {
  const collapsed = snippet.replace(/\s+/g, " ").trim();
  return collapsed.length > PREVIEW_CHARS ? `${collapsed.slice(0, PREVIEW_CHARS)}…` : collapsed;
}

/**
 * Locate-only search: returns compact pointers (path, line range, heading, a
 * short preview) so the caller can pick the right file — NOT the full passage.
 * Read the located file with read_source to get the content to answer from.
 */
export function createSearchKnowledgeBaseTool(store: Store): ToolDefinition<typeof parameters> {
  return {
    name: SEARCH_KNOWLEDGE_BASE_NAME,
    label: "Searching knowledge base",
    description:
      "Hybrid (dense + sparse, RRF-fused) semantic search over the current " +
      "profile's indexed source files, reranked to the most relevant passages. " +
      "Returns compact POINTERS — file path, line range, heading, and a short " +
      "preview — to help you locate the right file, not the full text. Pick the " +
      "best hit(s) and open the file with read_source to get the content you " +
      "answer from. Use a focused query naming the specific concept or entity you " +
      "need, not the user's whole sentence; prefer one precise search over several.",
    parameters,
    async execute({ query, limit }): Promise<string> {
      const hits = await store.sources.search(
        store.profileId,
        query,
        limit !== null ? { limit } : {},
      );
      if (!hits.length) return `No results for "${query}".`;
      const pointers = hits
        .map(
          (hit) =>
            `${hit.path}:${hit.startLine}-${hit.endLine} (score ${hit.score.toFixed(3)})\n${preview(hit.snippet)}`,
        )
        .join("\n\n");
      return `${pointers}\n\nOpen the best match with read_source to read the full file.`;
    },
    summarize: ({ query }) => query,
  };
}
