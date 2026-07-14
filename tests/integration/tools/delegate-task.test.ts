import { describe, expect, it } from "vitest";
import {
  DELEGATE_TASK_NAME,
  delegateTaskTool,
  parseDelegateTaskArgs,
  selectMemories,
} from "../../../src/tools/delegation/delegate-task";
import { toOpenAITool } from "../../../src/agent/tools/types";

describe("parseDelegateTaskArgs", () => {
  it("parses a valid payload with memory keys and profile", () => {
    const args = parseDelegateTaskArgs(
      JSON.stringify({
        title: "Compare X",
        task: "compare a and b",
        relevantMemoryKeys: ["M1", "M3"],
        profile: "general",
      }),
    );
    expect(args).toEqual({
      title: "Compare X",
      task: "compare a and b",
      relevantMemoryKeys: ["M1", "M3"],
      profile: "general",
    });
  });

  it("accepts null memory keys and profile", () => {
    const args = parseDelegateTaskArgs(
      JSON.stringify({ title: "T", task: "do it", relevantMemoryKeys: null, profile: null }),
    );
    expect(args.relevantMemoryKeys).toBeNull();
    expect(args.profile).toBeNull();
  });

  it("rejects a payload missing the title", () => {
    expect(() =>
      parseDelegateTaskArgs(
        JSON.stringify({ task: "do it", relevantMemoryKeys: null, profile: null }),
      ),
    ).toThrow();
  });

  it("rejects an empty task", () => {
    expect(() =>
      parseDelegateTaskArgs(
        JSON.stringify({ title: "T", task: "", relevantMemoryKeys: null, profile: null }),
      ),
    ).toThrow();
  });

  it("rejects an unknown profile", () => {
    expect(() =>
      parseDelegateTaskArgs(
        JSON.stringify({ title: "T", task: "x", relevantMemoryKeys: null, profile: "nope" }),
      ),
    ).toThrow();
  });
});

describe("selectMemories", () => {
  const memories = ["likes tea", "uses vim", "lives in Berlin"];

  it("resolves declared keys to their texts, order preserved", () => {
    expect(selectMemories(memories, ["M3", "M1"])).toEqual(["lives in Berlin", "likes tea"]);
  });

  it("returns none for null or empty keys", () => {
    expect(selectMemories(memories, null)).toEqual([]);
    expect(selectMemories(memories, [])).toEqual([]);
  });

  it("silently drops keys that do not resolve", () => {
    expect(selectMemories(memories, ["M2", "M9"])).toEqual(["uses vim"]);
  });
});

describe("delegateTaskTool", () => {
  it("produces a strict function-tool schema for the API", () => {
    const tool = toOpenAITool(delegateTaskTool);
    expect(tool).toMatchObject({
      type: "function",
      name: DELEGATE_TASK_NAME,
      label: "Delegating",
      strict: true,
    });
    expect(tool.parameters).toBeDefined();
  });

  it("summarizes a call to its title", () => {
    expect(
      delegateTaskTool.summarize?.({
        title: "Compare X",
        task: "...",
        relevantMemoryKeys: null,
        profile: null,
      }),
    ).toBe("Compare X");
  });
});
