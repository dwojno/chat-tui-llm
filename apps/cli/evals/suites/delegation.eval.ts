import { evalite } from "evalite";
import { DELEGATE_TASK_NAME } from "@chat/tools/delegation/delegate-task";
import {
  conciseArg,
  probePrompt,
  routing,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

const CONCISE_TITLE = { key: "title", maxWords: 10 } as const;

evalite<ProbeSpec, ProbeResult, Expected>("delegation routing", {
  data: () => [
    {
      input: {
        prompt:
          "Compare the cost of living, climate, and job market across Berlin, " +
          "Lisbon, and Austin, and recommend one for a remote software engineer.",
      },
      expected: { route: DELEGATE_TASK_NAME, conciseArg: CONCISE_TITLE },
    },
    {
      input: {
        prompt:
          "Research the main tradeoffs between server-side rendering and static " +
          "site generation, gather current best practices, and summarize when to " +
          "use each.",
      },
      expected: { route: DELEGATE_TASK_NAME, conciseArg: CONCISE_TITLE },
    },
    {
      input: {
        prompt:
          "Plan a product launch for me: research three competitors, draft a " +
          "rollout timeline, and outline a marketing plan.",
      },
      expected: { route: DELEGATE_TASK_NAME, conciseArg: CONCISE_TITLE },
    },
    {
      input: { prompt: "What is the capital of France?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Hey, how are you doing today?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "In one sentence, what is a closure in JavaScript?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Which is bigger, the Sun or the Moon?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Explain the difference between TCP and UDP." },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Write a short haiku about autumn." },
      expected: { route: "direct" },
    },
    {
      input: {
        prompt:
          "I've been wondering about this for a while — could you please just " +
          "tell me what the capital of Australia is?",
      },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [routing, conciseArg],
});
