import { z } from "zod";
import type { TurnEvent } from "../../agent/events/events";
import type { ToolDefinition } from "../../agent/tools/types";

export const WEB_SEARCH_TOOL_NAME = "web_search" as const;

const parameters = z.object({
  query: z.string().min(1).describe("What to search for"),
});

const SEARCH_LIMIT = 5;

type WikipediaSearch = {
  query?: { search?: { title: string; snippet: string }[] };
};

async function* execute({ query }: z.infer<typeof parameters>): AsyncGenerator<TurnEvent, string> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(SEARCH_LIMIT));
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: { "User-Agent": "chat-cli/1.0 (frameworkless agent demo)" },
  });
  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as WikipediaSearch;
  const hits = data.query?.search ?? [];
  if (hits.length === 0) {
    return `No results for "${query}".`;
  }

  return hits
    .map((hit, index) => {
      const snippet = hit.snippet.replace(/<[^>]*>/g, "").trim();
      return `${index + 1}. ${hit.title}: ${snippet}`;
    })
    .join("\n");
}

export const webSearchTool: ToolDefinition<typeof parameters> = {
  name: WEB_SEARCH_TOOL_NAME,
  label: "Searching the web",
  description:
    "Search the web for information on a topic. Returns a list of result " +
    "titles and snippets — use it for research, facts, and background.",
  parameters,
  execute,
  summarize: ({ query }) => query,
};
