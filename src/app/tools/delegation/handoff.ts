import type { OpenAI } from "openai";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import { zodTextFormat } from "openai/helpers/zod";
import { HANDOFF_MODEL } from "@/app/config";
import { renderItemsText } from "@/agent/conversation/items";
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

const HANDOFF_MAX_OUTPUT_TOKENS = 1500;
const MAX_FALLBACK_SUMMARY_CHARS = 500;

const TRUNCATED_SUMMARY =
  "Sub-agent result could not be compressed cleanly; see child spans for the full transcript.";

const fallbackResult = (summary: string): ForkResult => ({
  summary,
  findings: [],
  sources: null,
  confidence: "low",
  needsFollowup: null,
});

function sanitizeFallbackSummary(outputText: string): string {
  const text = outputText.trim();
  if (text === "" || text.startsWith("{") || text.startsWith("[")) {
    return TRUNCATED_SUMMARY;
  }
  return text.slice(0, MAX_FALLBACK_SUMMARY_CHARS);
}

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
    model: HANDOFF_MODEL,
    instructions: HANDOFF_INSTRUCTIONS,
    input,
    text: { format: zodTextFormat(ForkResultSchema, "fork_result") },
    temperature: 0.2,
    max_output_tokens: HANDOFF_MAX_OUTPUT_TOKENS,
    store: false,
  });

  const truncated = response.status === "incomplete";
  const parsed = response.output_parsed as ForkResult | null;
  const result =
    parsed && !truncated
      ? parsed
      : fallbackResult(sanitizeFallbackSummary(response.output_text ?? ""));
  return { result, usage: response.usage };
}
