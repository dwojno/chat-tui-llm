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

// Ambiguous prompts: the point is that the model SEEKS the missing information
// instead of guessing. Models reliably do this with a concise clarifying question
// in prose rather than by invoking the ask_user tool (verified across gpt-4o and
// gpt-4o-mini), and a prose question is fine — so this is judged on "asks vs
// guesses", not on which mechanism it used. A bare tool-call check would fail
// every model even though the behaviour is correct.
const SEEKS_CLARIFICATION =
  "The user's request is ambiguous or missing information needed to act (e.g. no " +
  "location, an unspecified referent like 'them', or an unnamed sentence/language). " +
  "PASS if the response asks the user for that missing detail — either by calling " +
  "the ask_user tool or with a concise clarifying question in plain text. FAIL if it " +
  "guesses, fabricates an answer, or acts as though the missing information had been " +
  "provided.";

/**
 * ask_user routing (see the <human_in_the_loop> block of SYSTEM_INSTRUCTIONS).
 * A genuinely ambiguous request should make the model seek clarification rather
 * than guess; a clear, answerable request should be handled directly, NOT bounced
 * back. Both directions are pinned so a prompt edit that makes the model over- or
 * under-ask is caught.
 */
evalite<ProbeSpec, ProbeResult, Expected>("ask_user routing", {
  data: () => [
    // ── Should seek clarification: ambiguous / missing the info to proceed ──
    {
      input: { prompt: "What's the weather like today?" },
      expected: { judge: SEEKS_CLARIFICATION },
    },
    { input: { prompt: "Can you compare them for me?" }, expected: { judge: SEEKS_CLARIFICATION } },
    {
      input: { prompt: "Translate this sentence into the other language." },
      expected: { judge: SEEKS_CLARIFICATION },
    },
    // ── Should be direct: clear and answerable, no clarification needed ───
    {
      input: { prompt: "What is the capital of France?" },
      expected: { route: "direct" },
    },
    {
      input: { prompt: "Explain what a closure is in one sentence." },
      expected: { route: "direct" },
    },
    // EDGE: a reasonable default exists — the model should act, not ask.
    {
      input: { prompt: "Write a short haiku about autumn." },
      expected: { route: "direct" },
    },
  ],
  task: (spec) => probePrompt({ ...spec, tools: TOOLS }),
  scorers: [routing, judged],
});
