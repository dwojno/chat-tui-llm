import { evalite } from "evalite";
import { FORK_INSTRUCTIONS } from "../../config";
import { forkTools } from "../../tools";
import { WEATHER_TOOL_NAME } from "../../tools/weather";
import { WEB_SEARCH_TOOL_NAME } from "../../tools/web-search";
import {
  avoidsTools,
  probePrompt,
  routing,
  toolArgument,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

/**
 * Fork tool discipline (see FORK_INSTRUCTIONS + forkTools). A sub-agent should
 * reach for the tool that fits the task — web_search for research, weather for
 * weather — and must NOT force an irrelevant tool when none applies. Pins the
 * fix for a fork calling get_weather_data on a research task: `route` checks it
 * picks the right tool, `avoidsTools` checks it doesn't grab the wrong one.
 */
evalite<ProbeSpec, ProbeResult, Expected>("fork tool routing", {
  data: () => [
    // ── Research → search the web, never the weather tool ────────────────
    {
      input: {
        prompt:
          "Summarize the main tradeoffs between server-side rendering and " +
          "static site generation, and current best practices for each.",
        instructions: FORK_INSTRUCTIONS,
        tools: forkTools,
      },
      expected: {
        route: WEB_SEARCH_TOOL_NAME,
        forbidTools: [WEATHER_TOOL_NAME],
      },
    },
    {
      input: {
        prompt: "Find current best practices for API rate limiting.",
        instructions: FORK_INSTRUCTIONS,
        tools: forkTools,
      },
      expected: {
        route: WEB_SEARCH_TOOL_NAME,
        forbidTools: [WEATHER_TOOL_NAME],
      },
    },
    // ── A genuine weather task still uses the weather tool in a fork ──────
    {
      input: {
        prompt: "What is the current weather in Tokyo?",
        instructions: FORK_INSTRUCTIONS,
        tools: forkTools,
      },
      expected: {
        route: WEATHER_TOOL_NAME,
        toolArg: { key: "city", contains: "Tokyo" },
      },
    },
    // EDGE: no tool fits — answer from knowledge, don't grab an unrelated tool.
    {
      input: {
        prompt: "Write a short haiku about autumn.",
        instructions: FORK_INSTRUCTIONS,
        tools: forkTools,
      },
      expected: {
        route: "direct",
        forbidTools: [WEATHER_TOOL_NAME, WEB_SEARCH_TOOL_NAME],
      },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, toolArgument, avoidsTools],
});
