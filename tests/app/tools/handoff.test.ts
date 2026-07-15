import { describe, expect, it, vi } from "vitest";
import assert from "node:assert";
import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { compressHandoff } from "@/app/tools/delegation/handoff";
import type { ForkResult } from "@/app/tools/delegation/fork-result";
import { usage } from "@tests/helpers/mock-openai";

function fakeOpenAI(parsed: ForkResult | null, outputText = "", status = "completed") {
  const parse = vi.fn(async (_params: unknown) => ({
    output_parsed: parsed,
    output_text: outputText,
    status,
    usage: usage(),
  }));
  return { client: { responses: { parse } } as unknown as OpenAI, parse };
}

const childItems: ResponseInputItem[] = [
  { role: "user", content: "research SSR" },
  { role: "assistant", content: "SSR renders on the server, TTFB 120ms" },
];

const forkResult: ForkResult = {
  summary: "SSR renders on the server",
  findings: [{ key: "TTFB", value: "120ms" }],
  sources: ["ssr-docs"],
  confidence: "high",
  needsFollowup: null,
};

describe("compressHandoff", () => {
  it("returns the parsed ForkResult and requests the structured format", async () => {
    const { client, parse } = fakeOpenAI(forkResult);

    const result = await compressHandoff(client, childItems, "");

    expect(result.result).toEqual(forkResult);
    expect(result.usage).toBeDefined();

    const call = parse.mock.calls[0];
    assert(call !== undefined);
    const params = call[0] as {
      input: string;
      instructions: string;
      text: { format: { name: string } };
    };
    expect(params.instructions).toContain("handoff");
    expect(params.text.format.name).toBe("fork_result");
    expect(params.input).toContain("Child transcript:");
    expect(params.input).toContain("user: research SSR");
  });

  it("requests a raised output budget so full results are not truncated", async () => {
    const { client, parse } = fakeOpenAI(forkResult);
    await compressHandoff(client, childItems, "");
    const call = parse.mock.calls[0];
    assert(call !== undefined);
    const params = call[0] as { max_output_tokens: number };
    expect(params.max_output_tokens).toBe(1500);
  });

  it("includes the prior child summary when present", async () => {
    const { client, parse } = fakeOpenAI(forkResult);
    await compressHandoff(client, childItems, "child was midway through");
    const call = parse.mock.calls[0];
    assert(call !== undefined);
    const params = call[0] as { input: string };
    expect(params.input).toContain("Prior child summary:");
    expect(params.input).toContain("child was midway through");
  });

  it("falls back to a low-confidence result when parsing fails", async () => {
    const { client } = fakeOpenAI(null, "raw text");
    const result = await compressHandoff(client, childItems, "");
    expect(result.result.confidence).toBe("low");
    expect(result.result.summary).toBe("raw text");
    expect(result.result.findings).toEqual([]);
  });

  it("treats a truncated response as a failure and sanitizes the JSON blob", async () => {
    
    const { client } = fakeOpenAI(forkResult, '{"summary":"SSR renders on the ser', "incomplete");
    const result = await compressHandoff(client, childItems, "");
    expect(result.result.confidence).toBe("low");
    expect(result.result.findings).toEqual([]);
    expect(result.result.summary).not.toContain("{");
    expect(result.result.summary).toContain("could not be compressed cleanly");
  });

  it("does not surface a raw JSON blob when parsing fails on a complete response", async () => {
    const { client } = fakeOpenAI(null, '{"summary":"half serialized');
    const result = await compressHandoff(client, childItems, "");
    expect(result.result.confidence).toBe("low");
    expect(result.result.summary).not.toContain("{");
    expect(result.result.summary).toContain("could not be compressed cleanly");
  });
});
