import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { summarize } from "../../src/conversation/summarizer";
import { usage } from "../helpers/mock-openai";

function fakeOpenAI(outputText: string) {
  const create = vi.fn(async (_params: unknown) => ({ output_text: outputText, usage: usage() }));
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

const evicted: ResponseInputItem[] = [
  { role: "user", content: "what is SSR?" },
  { role: "assistant", content: "server-side rendering" },
];

describe("summarize", () => {
  it("folds evicted turns into the prior summary and returns trimmed text", async () => {
    const { client, create } = fakeOpenAI("  a tidy summary  ");

    const result = await summarize(client, "earlier summary", evicted);

    expect(result.text).toBe("a tidy summary");
    expect(result.usage).toBeDefined();

    const params = create.mock.calls[0][0] as { input: string; temperature: number };
    expect(params.temperature).toBe(0.2);
    expect(params.input).toContain("Prior summary:");
    expect(params.input).toContain("earlier summary");
    expect(params.input).toContain("user: what is SSR?");
  });

  it("omits the prior-summary section when there is none", async () => {
    const { client, create } = fakeOpenAI("fresh");
    await summarize(client, "", evicted);
    const params = create.mock.calls[0][0] as { input: string };
    expect(params.input).not.toContain("Prior summary:");
  });
});
