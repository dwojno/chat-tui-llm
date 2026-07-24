import { evalite } from "evalite";
import { envConfig } from "@/platform/config";
import { FORK_INSTRUCTIONS } from "@chat/tools/prompts/fork";
import { createForkToolSchemas } from "@chat/tools";
import { WEB_SEARCH_TOOL_NAME } from "@chat/tools/web-search";
import {
  avoidsTools,
  probePrompt,
  routing,
  toolArgument,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const forkToolSchemas = createForkToolSchemas({
  maxResults: envConfig.tools.webSearch.maxResults,
  ...(envConfig.tools.webSearch.tavilyApiKey
    ? { tavilyApiKey: envConfig.tools.webSearch.tavilyApiKey }
    : {}),
});

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
        forbidTools: [WEB_SEARCH_TOOL_NAME],
      },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, toolArgument, avoidsTools],
});
