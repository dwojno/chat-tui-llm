import { evalite } from "evalite";
import { FORK_INSTRUCTIONS } from "@/app/tools/prompts/fork";
import { forkToolSchemas } from "@/app/tools";
import { WEATHER_TOOL_NAME } from "@/app/tools/weather";
import { WEB_SEARCH_TOOL_NAME } from "@/app/tools/web-search";
import {
  avoidsTools,
  probePrompt,
  routing,
  toolArgument,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

evalite<ProbeSpec, ProbeResult, Expected>("fork tool routing", {
  data: () => [
    {
      input: {
        prompt:
          "Summarize the main tradeoffs between server-side rendering and " +
          "static site generation, and current best practices for each.",
        instructions: FORK_INSTRUCTIONS,
        tools: forkToolSchemas,
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
        tools: forkToolSchemas,
      },
      expected: {
        route: WEB_SEARCH_TOOL_NAME,
        forbidTools: [WEATHER_TOOL_NAME],
      },
    },
    {
      input: {
        prompt: "What is the current weather in Tokyo?",
        instructions: FORK_INSTRUCTIONS,
        tools: forkToolSchemas,
      },
      expected: {
        route: WEATHER_TOOL_NAME,
        toolArg: { key: "city", contains: "Tokyo" },
      },
    },
    {
      input: {
        prompt: "Write a short haiku about autumn.",
        instructions: FORK_INSTRUCTIONS,
        tools: forkToolSchemas,
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
