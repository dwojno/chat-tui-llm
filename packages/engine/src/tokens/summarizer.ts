import type { AgentEvent } from "@chat/agent";
import { threadToPrompt } from "../thread/reducer";
import type { Model } from "@chat/platform/model";

const SUMMARIZER_INSTRUCTIONS =
  "You compress conversation history for another assistant. Merge the prior " +
  "summary with the new turns into a single concise summary (at most ~150 " +
  "words). Preserve concrete facts, decisions, user preferences, unresolved " +
  "questions, and any tool results still relevant. Drop pleasantries and " +
  "redundancy. Output only the summary text, no preamble.";

export interface SummaryResult {
  text: string;
}

export interface SummarizeArgs {
  model: Model;
  modelName: string;
  priorSummary: string;
  evicted: readonly AgentEvent[];
}

export async function summarize({
  model,
  modelName,
  priorSummary,
  evicted,
}: SummarizeArgs): Promise<SummaryResult> {
  const transcript = threadToPrompt(evicted);
  const input = [
    priorSummary ? `Prior summary:\n${priorSummary}` : "",
    `New turns to fold in:\n${transcript}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await model.complete({
    model: modelName,
    operation: "summarize",
    instructions: SUMMARIZER_INSTRUCTIONS,
    input,
    temperature: 0.2,
    maxOutputTokens: 600,
    store: false,
  });

  return { text: response.outputText.trim() };
}
