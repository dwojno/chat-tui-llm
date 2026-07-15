import { evalite } from "evalite";
import type { z } from "zod";
import { toOpenAITool, type ToolDefinition } from "@/agent/tools/types";
import { updateScratchpadTool, weatherTool } from "@/app/tools";
import {
  avoidsTools,
  probePrompt,
  routing,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const SCRATCHPAD = "update_scratchpad";
const WEATHER = "get_weather_data";

const TOOLS = ([weatherTool, updateScratchpadTool] as ToolDefinition<z.ZodType>[]).map(
  toOpenAITool,
);

evalite<ProbeSpec, ProbeResult, Expected>("scratchpad planning", {
  data: () => [
    {
      input: {
        prompt:
          "I'm deciding where to travel this weekend — Paris, Tokyo, or New York. Check the " +
          "weather in each city, then for whichever has the best weather find a few places " +
          "worth visiting there, and finish with a recommendation.",
        tools: TOOLS,
      },
      expected: { route: SCRATCHPAD, forbidTools: [WEATHER] },
    },
    {
      input: { prompt: "What's the weather in Paris right now?", tools: TOOLS },
      expected: { route: WEATHER, forbidTools: [SCRATCHPAD] },
    },
    {
      input: { prompt: "In one sentence, what is a REST API?", tools: TOOLS },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, avoidsTools],
});
