import { evalite } from "evalite";
import {
  probePrompt,
  routing,
  toolArgument,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const WEATHER = "get_weather_data";

evalite<ProbeSpec, ProbeResult, Expected>("weather routing", {
  data: () => [
    {
      input: { prompt: "What's the weather in Paris right now?" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Paris" } },
    },
    {
      input: { prompt: "Should I bring an umbrella in Tokyo today?" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Tokyo" } },
    },
    {
      input: { prompt: "hey whats the wheather in tokyo rn" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Tokyo" } },
    },
    {
      input: { prompt: "Can you explain what a REST API is?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "What's the weather like today?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "I just moved to Berlin last week and I love it here!" },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, toolArgument],
});
