import { z } from "zod";
import { isBrokenCircuitError } from "cockatiel";
import type { ToolDefinition } from "@/agent/tools/types";
import { createResiliencePolicy } from "@/platform/utils/resilience";

export const WEB_SEARCH_TOOL_NAME = "web_search" as const;

const parameters = z.object({
  query: z.string().min(1).describe("What to search for"),
});

const DEFAULT_MAX_RESULTS = 5;
const WEB_SEARCH_MAX_RETRIES = 3;

const policy = createResiliencePolicy({ maxRetries: WEB_SEARCH_MAX_RETRIES });

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
  ) {
    super(`${status} ${statusText}`);
  }
}

function maxResults(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.WEB_SEARCH_MAX_RESULTS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_RESULTS;
}

type TavilyResult = { title?: string; url?: string; content?: string };
type TavilyResponse = { answer?: string | null; results?: TavilyResult[] };

const SNIPPET_MAX_CHARS = 600;

function cleanSnippet(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // image embeds ![alt](url)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links [label](url) -> label
    .replace(/\b[a-zA-Z-]+='[^']*'/g, " ") // stray SVG/HTML attributes (d='…', fill='…')
    .replace(/%[0-9A-Fa-f]{2}/g, " ") // percent-encoded (data-URI / SVG) fragments
    .replace(/[↑•#*]/g, " ") // citation arrows, bullets, markdown markers
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SNIPPET_MAX_CHARS);
}

async function tavilySearch(query: string, apiKey: string, limit: number): Promise<string> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      include_answer: true,
    }),
  });
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText);
  }

  const data = (await response.json()) as TavilyResponse;
  const results = data.results ?? [];
  const answer = data.answer?.trim();
  if (results.length === 0 && !answer) {
    return `No results for "${query}".`;
  }

  const lines: string[] = [];
  if (answer) lines.push(`Answer: ${answer}`);
  results.forEach((hit, index) => {
    const title = hit.title?.trim() || "(untitled)";
    const url = hit.url?.trim() || "";
    const snippet = cleanSnippet(hit.content ?? "");
    lines.push(`${index + 1}. ${title} — ${url}\n${snippet}`);
  });
  return lines.join("\n\n");
}

function webSearchError(error: unknown): string {
  if (error instanceof HttpError) return `web_search error: ${error.status} ${error.statusText}`;
  if (isBrokenCircuitError(error)) {
    return "web_search error: service unavailable (circuit open); try again shortly.";
  }
  return `web_search error: ${error instanceof Error ? error.message : String(error)}`;
}

async function execute({ query }: z.infer<typeof parameters>): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "web_search error: TAVILY_API_KEY is not set; cannot search the web.";
  }
  const limit = maxResults();
  try {
    return await policy.execute(() => tavilySearch(query, apiKey, limit));
  } catch (error) {
    return webSearchError(error);
  }
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
