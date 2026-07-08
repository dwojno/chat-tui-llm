import { afterEach, describe, expect, it, vi } from "vitest";
import { describeToolCall, executeToolCall, forkTools, mainTools } from "../../../src/agent/tools";
import { DELEGATE_TASK_NAME } from "../../../src/agent/tools/delegate-task";
import { WEATHER_TOOL_NAME } from "../../../src/agent/tools/weather";
import { WEB_SEARCH_TOOL_NAME } from "../../../src/agent/tools/web-search";
import { drainToReturn } from "../../helpers/mock-openai";

afterEach(() => {
  vi.useRealTimers();
});

describe("executeToolCall", () => {
  it("runs a registered tool with parsed args", async () => {
    vi.useFakeTimers();
    const pending = drainToReturn(
      executeToolCall(WEATHER_TOOL_NAME, JSON.stringify({ city: "Paris" })),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("The weather in Paris is sunny");
  });

  it("throws for an unknown tool", () => {
    expect(() => executeToolCall("nope", "{}")).toThrow(/Unknown tool/);
  });
});

describe("describeToolCall", () => {
  it("summarizes a weather call to the city", () => {
    expect(describeToolCall(WEATHER_TOOL_NAME, JSON.stringify({ city: "Berlin" }))).toBe("Berlin");
  });

  it("summarizes a web_search call to the query", () => {
    expect(describeToolCall(WEB_SEARCH_TOOL_NAME, JSON.stringify({ query: "ssr" }))).toBe("ssr");
  });

  it("returns undefined for an unknown tool or unparseable args", () => {
    expect(describeToolCall("nope", "{}")).toBeUndefined();
    expect(describeToolCall(WEATHER_TOOL_NAME, "not json")).toBeUndefined();
  });
});

describe("tool sets", () => {
  it("main tools = weather + delegate_task", () => {
    const names = mainTools.map((t) => t.name);
    expect(names).toContain(WEATHER_TOOL_NAME);
    expect(names).toContain(DELEGATE_TASK_NAME);
  });

  it("fork tools = weather + web_search, and never delegate_task (no recursion)", () => {
    const names = forkTools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([WEATHER_TOOL_NAME, WEB_SEARCH_TOOL_NAME]));
    expect(names).not.toContain(DELEGATE_TASK_NAME);
  });
});
