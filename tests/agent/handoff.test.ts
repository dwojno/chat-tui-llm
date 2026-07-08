import { describe, expect, it, vi } from "vitest";
import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { compressHandoff } from "../../src/agent/tools/utils/handoff";
import { usage } from "../helpers/mock-openai";

function fakeOpenAI(outputText: string) {
  const create = vi.fn(async (_params: unknown) => ({
    output_text: outputText,
    usage: usage(),
  }));
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

const childItems: ResponseInputItem[] = [
  { role: "user", content: "research SSR" },
  { role: "assistant", content: "SSR renders on the server" },
];

describe("compressHandoff", () => {
  it("distills the child transcript into a trimmed digest", async () => {
    const { client, create } = fakeOpenAI("  digest text  ");

    const result = await compressHandoff(client, childItems, "");

    expect(result.text).toBe("digest text");
    expect(result.usage).toBeDefined();

    const params = create.mock.calls[0][0] as {
      input: string;
      instructions: string;
    };
    expect(params.instructions).toContain("handoff");
    expect(params.input).toContain("Child transcript:");
    expect(params.input).toContain("user: research SSR");
  });

  it("includes the prior child summary when present", async () => {
    const { client, create } = fakeOpenAI("digest");
    await compressHandoff(client, childItems, "child was midway through");
    const params = create.mock.calls[0][0] as { input: string };
    expect(params.input).toContain("Prior child summary:");
    expect(params.input).toContain("child was midway through");
  });
});
