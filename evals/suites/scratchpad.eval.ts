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

// Menu is deliberately weather + scratchpad only — no delegate_tasks escape hatch,
// so a sequential multi-step ask is graded on whether it plans with the scratchpad.
const TOOLS = ([weatherTool, updateScratchpadTool] as ToolDefinition<z.ZodType>[]).map(
  toOpenAITool,
);

/**
 * Scratchpad usage (see <scratchpad>). On a multi-step task the model should lay
 * out its todo/plan FIRST — call update_scratchpad before touching the work
 * tools — then work the plan. On a single-step or trivial ask it should not
 * bother planning. `routing` checks the tool it chose on turn one; `avoidsTools`
 * checks it didn't jump ahead (or over-plan).
 */
evalite<ProbeSpec, ProbeResult, Expected>("scratchpad planning", {
  data: () => [
    // ── Multi-step → reason + plan first, before starting the work ───────
    // No "keep a todo" hand-holding: an implicit multi-step task the agent
    // should recognise and plan on its own.
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
    // ── Single-step → just do it, don't over-plan ────────────────────────
    {
      input: { prompt: "What's the weather in Paris right now?", tools: TOOLS },
      expected: { route: WEATHER, forbidTools: [SCRATCHPAD] },
    },
    // ── Trivial → answer directly, no tools at all ───────────────────────
    {
      input: { prompt: "In one sentence, what is a REST API?", tools: TOOLS },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, avoidsTools],
});
