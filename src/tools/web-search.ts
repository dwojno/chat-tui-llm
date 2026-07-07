import { z } from 'zod'
import type { ToolDefinition } from './types'

export const WEB_SEARCH_TOOL_NAME = 'web_search' as const

const parameters = z.object({
  query: z.string().min(1).describe('What to search for'),
})

const SEARCH_LIMIT = 5

type WikipediaSearch = {
  query?: { search?: { title: string; snippet: string }[] }
}

/**
 * A real, keyless search backed by the Wikipedia API — genuinely useful for
 * research without an API key or a new dependency (uses global `fetch`), in
 * keeping with the frameworkless demo. Failures surface as an error string;
 * `executeToolCall` feeds that back so the model can recover (and the fork
 * prompt lets it fall back to its own knowledge).
 */
async function execute({ query }: z.infer<typeof parameters>): Promise<string> {
  const url = new URL('https://en.wikipedia.org/w/api.php')
  url.searchParams.set('action', 'query')
  url.searchParams.set('list', 'search')
  url.searchParams.set('srsearch', query)
  url.searchParams.set('srlimit', String(SEARCH_LIMIT))
  url.searchParams.set('format', 'json')

  const response = await fetch(url, {
    headers: { 'User-Agent': 'chat-cli/1.0 (frameworkless agent demo)' },
  })
  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as WikipediaSearch
  const hits = data.query?.search ?? []
  if (hits.length === 0) {
    return `No results for "${query}".`
  }

  return hits
    .map((hit, index) => {
      // Snippets come back with HTML highlight markup — strip it for the model.
      const snippet = hit.snippet.replace(/<[^>]*>/g, '').trim()
      return `${index + 1}. ${hit.title}: ${snippet}`
    })
    .join('\n')
}

export const webSearchTool: ToolDefinition<typeof parameters> = {
  name: WEB_SEARCH_TOOL_NAME,
  label: 'Searching the web',
  description:
    'Search the web for information on a topic. Returns a list of result ' +
    'titles and snippets — use it for research, facts, and background.',
  parameters,
  execute,
  summarize: ({ query }) => query,
}
