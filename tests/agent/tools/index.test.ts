import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeToolCall, executeToolCall, toolLabel } from "@/agent/tools";
import type { ToolDefinition } from "@/agent/tools/types";

const params = z.object({ city: z.string() });
const fakeTool: ToolDefinition<typeof params> = {
  name: "get_weather_data",
  label: "Fetching weather data",
  description: "test",
  parameters: params,
  execute: async ({ city }) => `weather in ${city}`,
  summarize: ({ city }) => city,
};
const tools = [fakeTool] as ToolDefinition<z.ZodType>[];

describe("executeToolCall", () => {
  it("runs a tool from the given list with parsed args", async () => {
    const out = await executeToolCall(tools, "get_weather_data", JSON.stringify({ city: "Paris" }));
    expect(out).toBe("weather in Paris");
  });

  it("throws for a tool not in the list", () => {
    expect(() => executeToolCall(tools, "nope", "{}")).toThrow(/Unknown tool/);
  });
});

describe("describeToolCall", () => {
  it("summarizes via the resolved tool", () => {
    expect(describeToolCall(tools, "get_weather_data", JSON.stringify({ city: "Berlin" }))).toBe(
      "Berlin",
    );
  });

  it("returns undefined for an unknown tool or unparseable args", () => {
    expect(describeToolCall(tools, "nope", "{}")).toBeUndefined();
    expect(describeToolCall(tools, "get_weather_data", "not json")).toBeUndefined();
  });
});

describe("toolLabel", () => {
  it("returns the tool's label or undefined", () => {
    expect(toolLabel(tools, "get_weather_data")).toBe("Fetching weather data");
    expect(toolLabel(tools, "nope")).toBeUndefined();
  });
});
