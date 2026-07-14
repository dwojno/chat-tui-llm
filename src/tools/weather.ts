import { z } from "zod";
import type { ToolDefinition } from "../agent/tools/types";

export const WEATHER_TOOL_NAME = "get_weather_data" as const;

const parameters = z.object({
  city: z.string(),
});

async function execute({ city }: z.infer<typeof parameters>): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return `The weather in ${city} is sunny`;
}

export const weatherTool: ToolDefinition<typeof parameters> = {
  name: WEATHER_TOOL_NAME,
  label: "Fetching weather data",
  description: "Get the weather data for a city",
  parameters,
  execute,
  summarize: ({ city }) => city,
};
