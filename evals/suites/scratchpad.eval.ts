import { evalite } from "evalite";
import type { z } from "zod";
import { toOpenAITool, type ToolDefinition } from "@chat/agent/tools/types";
import { updateScratchpadTool, webSearchTool } from "@/app/tools";
import {
  avoidsTools,
  probePrompt,
  routing,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const SCRATCHPAD = "update_scratchpad";
const WEB = "web_search";

const TOOLS = ([webSearchTool, updateScratchpadTool] as ToolDefinition<z.ZodType>[]).map(
  toOpenAITool,
);

evalite<ProbeSpec, ProbeResult, Expected>("scratchpad planning", {
  data: () => [
    {
      input: {
        prompt:
          "I'm deciding where to travel this weekend — Paris, Tokyo, or New York. Research the " +
          "main attractions in each city, then for whichever sounds best find a few places " +
          "worth visiting there, and finish with a recommendation.",
        tools: TOOLS,
      },
      expected: { route: SCRATCHPAD, forbidTools: [WEB] },
    },
    {
      input: { prompt: "Find the current population of Paris.", tools: TOOLS },
      expected: { route: WEB, forbidTools: [SCRATCHPAD] },
    },
    {
      input: { prompt: "In one sentence, what is a REST API?", tools: TOOLS },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, avoidsTools],
});
