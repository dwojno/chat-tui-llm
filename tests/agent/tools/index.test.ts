import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeToolCall, executeToolCall, toolLabel } from "../../../src/agent/tools";
import type { ToolDefinition } from "../../../src/agent/tools/types";
import { drain } from "../../../src/utils/async-gen";

const params = z.object({ city: z.string() });
const fakeTool: ToolDefinition<typeof params> = {
  name: "get_weather_data",
  label: "Fetching weather data",
  description: "test",
  parameters: params,
  async *execute({ city }) {
    return `weather in ${city}`;
  },
  summarize: ({ city }) => city,
};
const tools = [fakeTool] as ToolDefinition<z.ZodType>[];

describe("executeToolCall", () => {
  it("runs a tool from the given list with parsed args", async () => {
    const out = await drain(
      executeToolCall(tools, "get_weather_data", JSON.stringify({ city: "Paris" })),
    );
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
