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

/**
 * Weather-tool routing (see <tool_use>). A single-city weather ask should call
 * get_weather_data with the right city; an unrelated question should not touch
 * the tool at all. The `routing` scorer checks the decision, `toolArgument`
 * checks the extracted city.
 */
evalite<ProbeSpec, ProbeResult, Expected>("weather routing", {
  data: () => [
    // ── Clear weather asks: call the tool with the right city ────────────
    {
      input: { prompt: "What's the weather in Paris right now?" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Paris" } },
    },
    {
      input: { prompt: "Should I bring an umbrella in Tokyo today?" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Tokyo" } },
    },
    // EDGE: sloppy casing/typo — must still extract the city.
    {
      input: { prompt: "hey whats the wheather in tokyo rn" },
      expected: { route: WEATHER, toolArg: { key: "city", contains: "Tokyo" } },
    },
    // ── Must NOT call the tool ───────────────────────────────────────────
    {
      input: { prompt: "Can you explain what a REST API is?" },
      expected: { route: "direct" },
    },
    // EDGE: no city given — the model must ask, not fabricate a city arg.
    {
      input: { prompt: "What's the weather like today?" },
      expected: { route: "direct" },
    },
    // EDGE: a city is mentioned but there is no weather intent at all.
    {
      input: { prompt: "I just moved to Berlin last week and I love it here!" },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, toolArgument],
});
