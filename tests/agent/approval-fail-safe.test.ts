import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "@/agent/agent";
import type { ToolDefinition } from "@/agent/tools/types";
import { WRITE_FILE_NAME, writeFileTool } from "@/app/tools/write-file";
import { createMockOpenAI } from "@tests/helpers/mock-openai";

const readOnly: ToolDefinition<z.ZodType> = {
  name: "safe_lookup",
  label: "Lookup",
  description: "read-only",
  parameters: z.object({ q: z.string() }),
  execute: async () => "ok",
};

const agent = new Agent({
  openai: createMockOpenAI().client,
  temperature: 0.7,
  cacheKey: "chat-cli:test",
  instructions: "system",
  tools: [writeFileTool as ToolDefinition<z.ZodType>, readOnly],
});

const required = (name: string, args: string): boolean =>
  agent.toolMeta({ name, arguments: args }).approval.required;

describe("approval fail-safe on unparseable / adversarial args", () => {
  it("gates an approval-capable tool when args are malformed JSON", () => {
    expect(required(WRITE_FILE_NAME, "{not valid json")).toBe(true);
  });

  it("gates it when args are valid JSON but fail the schema", () => {
    expect(required(WRITE_FILE_NAME, '{"path":123}')).toBe(true);
  });

  it("gates it on a binary/control-byte args blob", () => {
    expect(required(WRITE_FILE_NAME, "\x00\x01\xff\x1b[2J")).toBe(true);
  });

  it("still gates well-formed destructive args", () => {
    expect(required(WRITE_FILE_NAME, '{"path":"x.txt","content":"y"}')).toBe(true);
  });

  it("does not gate a read-only tool when its args are malformed", () => {
    expect(required("safe_lookup", "{bad")).toBe(false);
  });
});
