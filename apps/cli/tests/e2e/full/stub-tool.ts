import { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";

// Deterministic, offline tool the e2e turns drive (mock model calls it by name).
// Lives in tests, not prod: the real app ships no fake tools.
const parameters = z.object({
  city: z.string(),
});

export const weatherStubTool: ToolDefinition<typeof parameters> = {
  name: "get_weather_data",
  label: "Fetching weather data",
  description: "Get the weather data for a city",
  parameters,
  execute: async ({ city }) => `The weather in ${city} is sunny`,
  summarize: ({ city }) => city,
};
