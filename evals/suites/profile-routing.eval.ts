import { evalite } from "evalite";
import { DELEGATE_TASK_NAME } from "@/app/tools/delegation/delegate-task";
import {
  probePrompt,
  routing,
  toolArgument,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

evalite<ProbeSpec, ProbeResult, Expected>("profile routing", {
  data: () => [
    {
      input: {
        prompt: "Per our indexed project docs, what are the deployment steps and quota limits?",
      },
      expected: {
        route: DELEGATE_TASK_NAME,
        toolArg: { key: "profile", contains: "rag_research" },
      },
    },
    {
      input: { prompt: "What does the knowledge base say about our security policy?" },
      expected: {
        route: DELEGATE_TASK_NAME,
        toolArg: { key: "profile", contains: "rag_research" },
      },
    },
    {
      input: {
        prompt: "Research current pricing and recent reviews of the top three electric SUVs.",
      },
      expected: {
        route: DELEGATE_TASK_NAME,
        toolArg: { key: "profile", contains: "web_research" },
      },
    },
    {
      input: {
        prompt: "Find the latest news on the Mars Sample Return mission and summarize it.",
      },
      expected: {
        route: DELEGATE_TASK_NAME,
        toolArg: { key: "profile", contains: "web_research" },
      },
    },
    { input: { prompt: "What is 17 times 3?" }, expected: { route: "direct" } },
    {
      input: { prompt: "In one sentence, what is a pure function?" },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, toolArgument],
});
