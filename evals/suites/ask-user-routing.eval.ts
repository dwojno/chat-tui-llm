import { evalite } from "evalite";
import { ASK_USER_NAME, askUserTool } from "../../src/integration/tools/ask-user";
import { mainToolSchemas } from "../../src/integration/tools";
import { toOpenAITool } from "../../src/agent/tools/types";
import { probePrompt, routing, type Expected, type ProbeResult, type ProbeSpec } from "../harness";

const TOOLS = [...mainToolSchemas, toOpenAITool(askUserTool)];

/**
 * ask_user routing (see the <human_in_the_loop> block of SYSTEM_INSTRUCTIONS).
 * A request that is genuinely ambiguous or missing information the model needs
 * to act should call ask_user; a request that is clear and answerable should be
 * handled directly, NOT bounced back to the user. Both directions are pinned so
 * a prompt edit that makes the model over- or under-ask is caught.
 */
evalite<ProbeSpec, ProbeResult, Expected>("ask_user routing", {
  data: () => [
    // ── Should ask: ambiguous / missing the info needed to proceed ───────
    {
      input: { prompt: "What's the weather like today?" },
      expected: { route: ASK_USER_NAME },
    },
    {
      input: { prompt: "Can you compare them for me?" },
      expected: { route: ASK_USER_NAME },
    },
    {
      input: { prompt: "Translate this sentence into the other language." },
      expected: { route: ASK_USER_NAME },
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
  scorers: [routing],
});
