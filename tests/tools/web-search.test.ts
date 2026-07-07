import { afterEach, describe, expect, it, vi } from "vitest";
import { webSearchTool } from "../../src/tools/web-search";

function mockFetch(impl: () => unknown) {
  const fetchMock = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webSearchTool", () => {
  it("formats results and strips HTML from snippets", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        query: {
          search: [
            {
              title: "Server-side rendering",
              snippet: 'renders <span class="hl">HTML</span> on the server',
            },
            { title: "SSG", snippet: "builds pages at <b>build</b> time" },
          ],
        },
      }),
    }));

    const result = await webSearchTool.execute({ query: "SSR vs SSG" });

    expect(result).toBe(
      [
        "1. Server-side rendering: renders HTML on the server",
        "2. SSG: builds pages at build time",
      ].join("\n"),
    );
  });

  it("reports when there are no results", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ query: { search: [] } }) }));
    expect(await webSearchTool.execute({ query: "zxqw" })).toBe('No results for "zxqw".');
  });

  it("throws on a non-ok response so the loop can feed the error back", async () => {
    mockFetch(() => ({ ok: false, status: 503, statusText: "Service Unavailable" }));
    await expect(webSearchTool.execute({ query: "x" })).rejects.toThrow(/503/);
  });

  it("summarizes a call to the query", () => {
    expect(webSearchTool.summarize?.({ query: "rate limiting" })).toBe("rate limiting");
  });
});
