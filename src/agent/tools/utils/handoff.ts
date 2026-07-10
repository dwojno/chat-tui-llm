import type { OpenAI } from "openai";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import { zodTextFormat } from "openai/helpers/zod";
import { MODEL } from "../../config";
import { renderItemsText } from "../../conversation/items";
import { ForkResultSchema, type ForkResult } from "./fork-result";

const HANDOFF_INSTRUCTIONS =
  "Compress this sub-agent transcript into a structured handoff for a parent " +
  "assistant. Prioritize EXACT VALUES over prose: put every concrete number, " +
  "file path, identifier, URL, version, or name in `findings` as a {key, value} " +
  "pair, with the value copied VERBATIM as a string — never round, paraphrase, " +
  "or bury an exact value inside `summary`. `summary` is a plain-language digest " +
  "of conclusions and decisions in at most 80 words. `sources` lists the " +
  "citations or file paths the parent can reference, or null if none. " +
  "`confidence` is 'high' when the task was answered from solid evidence, else " +
  "'low'. `needsFollowup` names the single most important unresolved question, " +
  "or null. Omit tool names, retries, and boilerplate.";

/** Used when the model returns no parseable structured output. */
const fallbackResult = (summary: string): ForkResult => ({
  summary,
  findings: [],
  sources: null,
  confidence: "low",
  needsFollowup: null,
});

export interface HandoffResult {
  result: ForkResult;
  usage: ResponseUsage | undefined;
}

export async function compressHandoff(
  openai: OpenAI,
  childItems: readonly ResponseInputItem[],
  childSummary: string,
): Promise<HandoffResult> {
  const transcript = renderItemsText([...childItems]);
  const input = [
    childSummary ? `Prior child summary:\n${childSummary}\n` : "",
    `Child transcript:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await openai.responses.parse({
    model: MODEL,
    instructions: HANDOFF_INSTRUCTIONS,
    input,
    text: { format: zodTextFormat(ForkResultSchema, "fork_result") },
    temperature: 0.2,
    max_output_tokens: 400,
    store: false,
  });

  const parsed = response.output_parsed as ForkResult | null;
  const result = parsed ?? fallbackResult(response.output_text?.trim() ?? "");
  return { result, usage: response.usage };
}
