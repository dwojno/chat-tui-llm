import type { OpenAI } from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import { CHEAP_MODEL } from "../config";
import type { AgentEvent } from "../runner/thread/events";
import { threadToPrompt } from "../runner/thread/reducer";

const SUMMARIZER_INSTRUCTIONS =
  "You compress conversation history for another assistant. Merge the prior " +
  "summary with the new turns into a single concise summary (at most ~150 " +
  "words). Preserve concrete facts, decisions, user preferences, unresolved " +
  "questions, and any tool results still relevant. Drop pleasantries and " +
  "redundancy. Output only the summary text, no preamble.";

export interface SummaryResult {
  text: string;
  usage: ResponseUsage | undefined;
}

export async function summarize(
  openai: OpenAI,
  priorSummary: string,
  evicted: readonly AgentEvent[],
): Promise<SummaryResult> {
  const transcript = threadToPrompt(evicted);
  const input = [
    priorSummary ? `Prior summary:\n${priorSummary}` : "",
    `New turns to fold in:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await openai.responses.create({
    model: CHEAP_MODEL,
    instructions: SUMMARIZER_INSTRUCTIONS,
    input,
    temperature: 0.2,
    max_output_tokens: 600,
    store: false,
  });

  return { text: response.output_text.trim(), usage: response.usage };
}
