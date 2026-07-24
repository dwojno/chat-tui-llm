import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import { summarize } from "@/app/tokens/summarizer";
import type { AgentEvent } from "@/app/runner/thread/events";
import { Model } from "@/platform/model";
import { usage } from "@tests/helpers/mock-openai";

function fakeModel(outputText: string) {
  const create = vi.fn(async (_params: unknown) => ({
    output_text: outputText,
    usage: usage(),
  }));
  const client = { responses: { create } } as unknown as OpenAI;
  return { model: Model.fromOpenAI(client), create };
}

const evicted: AgentEvent[] = [
  { type: "user_message", content: "what is SSR?" },
  { type: "assistant_answer", content: "server-side rendering" },
];

describe("summarize", () => {
  it("folds evicted turns into the prior summary and returns trimmed text", async () => {
    const { model, create } = fakeModel("  a tidy summary  ");

    const result = await summarize(model, "earlier summary", evicted);

    expect(result.text).toBe("a tidy summary");

    const params = create.mock.calls[0]![0] as {
      input: string;
      temperature: number;
    };
    expect(params.temperature).toBe(0.2);
    expect(params.input).toContain("Prior summary:");
    expect(params.input).toContain("earlier summary");
    expect(params.input).toContain("what is SSR?");
  });

  it("omits the prior-summary section when there is none", async () => {
    const { model, create } = fakeModel("fresh");
    await summarize(model, "", evicted);
    const params = create.mock.calls[0]![0] as { input: string };
    expect(params.input).not.toContain("Prior summary:");
  });
});
