import { describe, expect, it } from "vitest";
import {
  DELEGATE_TASK_NAME,
  delegateTaskTool,
  parseDelegateTaskArgs,
} from "../../../src/agent/tools/delegate-task";
import { toOpenAITool } from "../../../src/agent/tools/types";

describe("parseDelegateTaskArgs", () => {
  it("parses a valid title + task payload", () => {
    const args = parseDelegateTaskArgs(
      JSON.stringify({ title: "Compare X", task: "compare a and b" }),
    );
    expect(args).toEqual({ title: "Compare X", task: "compare a and b" });
  });

  it("rejects a payload missing the title", () => {
    expect(() => parseDelegateTaskArgs(JSON.stringify({ task: "do it" }))).toThrow();
  });

  it("rejects an empty task", () => {
    expect(() => parseDelegateTaskArgs(JSON.stringify({ title: "T", task: "" }))).toThrow();
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
    expect(delegateTaskTool.summarize?.({ title: "Compare X", task: "..." })).toBe("Compare X");
  });
});
