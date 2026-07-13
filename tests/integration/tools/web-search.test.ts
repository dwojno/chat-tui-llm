import { afterEach, describe, expect, it, vi } from "vitest";
import { webSearchTool } from "../../../src/integration/tools/web-search";
import { drain } from "../../../src/utils/async-gen";

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn(async (_url: unknown, _init?: { body: string }) => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("webSearchTool", () => {
  it("formats Tavily results with title, url, and clean content", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        answer: "SSR renders on the server; SSG builds at build time.",
        results: [
          {
            title: "Server-side rendering",
            url: "https://example.com/ssr",
            content: "SSR renders HTML on the server for each request.",
          },
          {
            title: "Static site generation",
            url: "https://example.com/ssg",
            content: "SSG builds pages at build time.",
          },
        ],
      }),
    }));

    const result = await drain(webSearchTool.execute({ query: "SSR vs SSG" }));

    expect(result).toBe(
      [
        "Answer: SSR renders on the server; SSG builds at build time.",
        "1. Server-side rendering — https://example.com/ssr\nSSR renders HTML on the server for each request.",
        "2. Static site generation — https://example.com/ssg\nSSG builds pages at build time.",
      ].join("\n\n"),
    );
  });

  it("strips markdown links, citation cruft, and SVG blobs from snippets", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        results: [
          {
            title: "Soundgarden",
            url: "https://en.wikipedia.org/wiki/Soundgarden",
            content:
              "**Soundgarden** formed in 1984. " +
              "[↑](https://en.wikipedia.org/wiki/Soundgarden#cite_ref-168)Blistein, Jon. " +
              "![logo](https://example.com/a.png) '/%3E%3Cpath d='M16.0001 7.9996z' fill='url(%23p)'/%3E",
          },
        ],
      }),
    }));

    const result = await drain(webSearchTool.execute({ query: "Soundgarden" }));

    expect(result).toContain("Soundgarden formed in 1984.");
    expect(result).toContain("Blistein, Jon.");
    expect(result).not.toMatch(/\[↑\]|cite_ref|!\[|%3E|d='|fill=/);
  });

  it("sends the query and result cap to Tavily", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    vi.stubEnv("WEB_SEARCH_MAX_RESULTS", "3");
    const fetchMock = mockFetch(() => ({ ok: true, json: async () => ({ results: [] }) }));

    await drain(webSearchTool.execute({ query: "rate limiting" }));

    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body ?? "{}");
    expect(body.query).toBe("rate limiting");
    expect(body.max_results).toBe(3);
    expect(body.api_key).toBe("tvly-test");
  });

  it("reports when there are no results", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    mockFetch(() => ({ ok: true, json: async () => ({ results: [] }) }));
    expect(await drain(webSearchTool.execute({ query: "zxqw" }))).toBe('No results for "zxqw".');
  });

  it("returns a recoverable error string on a non-ok response", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    mockFetch(() => ({ ok: false, status: 429, statusText: "Too Many Requests" }));
    expect(await drain(webSearchTool.execute({ query: "x" }))).toBe(
      "web_search error: 429 Too Many Requests",
    );
  });

  it("returns a recoverable error string when no API key is set", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const fetchMock = mockFetch(() => ({ ok: true, json: async () => ({ results: [] }) }));
    const result = await drain(webSearchTool.execute({ query: "x" }));
    expect(result).toMatch(/TAVILY_API_KEY is not set/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("summarizes a call to the query", () => {
    expect(webSearchTool.summarize?.({ query: "rate limiting" })).toBe("rate limiting");
  });
});
