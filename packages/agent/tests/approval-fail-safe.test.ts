import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent, type Model, type ToolDefinition } from "@chat/agent";

const GUARDED_TOOL_NAME = "write_file";
const guarded: ToolDefinition<z.ZodType> = {
  name: GUARDED_TOOL_NAME,
  label: "Write file",
  description: "writes a file",
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async () => "ok",
  requiresApproval: true,
};

const readOnly: ToolDefinition<z.ZodType> = {
  name: "safe_lookup",
  label: "Lookup",
  description: "read-only",
  parameters: z.object({ q: z.string() }),
  execute: async () => "ok",
};

const model: Model = {
  complete: async () => {
    throw new Error("not used");
  },
};

const agent = new Agent({
  model,
  temperature: 0.7,
  cacheKey: "chat-cli:test",
  instructions: "system",
  tools: [guarded, readOnly],
});

const required = (name: string, args: string): boolean =>
  agent.toolMeta({ name, arguments: args }).approval.required;

describe("approval fail-safe on unparseable / adversarial args", () => {
  it("gates an approval-capable tool when args are malformed JSON", () => {
    expect(required(GUARDED_TOOL_NAME, "{not valid json")).toBe(true);
  });

  it("gates it when args are valid JSON but fail the schema", () => {
    expect(required(GUARDED_TOOL_NAME, '{"path":123}')).toBe(true);
  });

  it("gates it on a binary/control-byte args blob", () => {
    expect(required(GUARDED_TOOL_NAME, "\x00\x01\xff\x1b[2J")).toBe(true);
  });

  it("still gates well-formed destructive args", () => {
    expect(required(GUARDED_TOOL_NAME, '{"path":"x.txt","content":"y"}')).toBe(true);
  });

  it("does not gate a read-only tool when its args are malformed", () => {
    expect(required("safe_lookup", "{bad")).toBe(false);
  });
});
