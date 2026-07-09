import { evalite } from "evalite";
import { DELEGATE_TASK_NAME } from "../../src/integration/tools/delegate-task";
import {
  conciseArg,
  probePrompt,
  routing,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

/** When delegating, the `title` must be a short label, not a copy of the prompt. */
const CONCISE_TITLE = { key: "title", maxWords: 10 } as const;

/**
 * Delegation routing (see the <delegation> block of SYSTEM_INSTRUCTIONS).
 * The prompt's contract: multi-step research / comparison / exploratory work
 * → delegate_task; simple one-shot questions → answer directly. Both directions
 * are pinned so a prompt edit that makes the model over- or under-delegate is
 * caught.
 */
evalite<ProbeSpec, ProbeResult, Expected>("delegation routing", {
  data: () => [
    // ── Should delegate: genuinely multi-step ────────────────────────────
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
    // ── Should be direct: simple, despite comparison/research-sounding words
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
    // EDGE: "compare" keyword but a trivial one-shot — must NOT delegate.
    {
      input: { prompt: "Which is bigger, the Sun or the Moon?" },
      expected: { route: "direct" },
    },
    // EDGE: "explain the difference" reads like research but is one-shot knowledge.
    {
      input: { prompt: "Explain the difference between TCP and UDP." },
      expected: { route: "direct" },
    },
    // EDGE: creative single-shot task — no sub-agent needed.
    {
      input: { prompt: "Write a short haiku about autumn." },
      expected: { route: "direct" },
    },
    // EDGE: verbose padding around plain trivia — the wrapper must not trigger a fork.
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
