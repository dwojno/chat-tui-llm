import { evalite } from "evalite";
import { askUserTool } from "@/app/tools/ask-user";
import { mainToolSchemas } from "@/app/tools";
import { toOpenAITool } from "@/agent/tools/types";
import {
  judged,
  probePrompt,
  routing,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const TOOLS = [...mainToolSchemas, toOpenAITool(askUserTool)];

const SEEKS_CLARIFICATION =
  "The user's request is ambiguous or missing information needed to act (e.g. no " +
  "location, an unspecified referent like 'them', or an unnamed sentence/language). " +
  "PASS if the response asks the user for that missing detail — either by calling " +
  "the ask_user tool or with a concise clarifying question in plain text. FAIL if it " +
  "guesses, fabricates an answer, or acts as though the missing information had been " +
  "provided.";

evalite<ProbeSpec, ProbeResult, Expected>("ask_user routing", {
  data: () => [
    {
      input: { prompt: "What's the weather like today?" },
      expected: { judge: SEEKS_CLARIFICATION },
    },
    { input: { prompt: "Can you compare them for me?" }, expected: { judge: SEEKS_CLARIFICATION } },
    {
      input: { prompt: "Translate this sentence into the other language." },
      expected: { judge: SEEKS_CLARIFICATION },
    },
    {
      input: { prompt: "What is the capital of France?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Explain what a closure is in one sentence." },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Write a short haiku about autumn." },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt({ ...spec, tools: TOOLS }),
  scorers: [routing, judged],
});
