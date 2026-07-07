import type { OpenAI } from "openai";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import { MODEL } from "../config";
import { renderItemsText } from "./items";

const HANDOFF_INSTRUCTIONS =
  "Compress this sub-agent transcript into a handoff for a parent assistant. " +
  "Output at most 120 words. Include: conclusions, decisions, key data, " +
  "unresolved questions. Omit tool names, retries, and boilerplate. " +
  "Output only the handoff text.";

export interface HandoffResult {
  text: string;
  usage: ResponseUsage | undefined;
}

/**
 * Distill a forked child conversation into a short digest for the main thread.
 */
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

  const response = await openai.responses.create({
    model: MODEL,
    instructions: HANDOFF_INSTRUCTIONS,
    input,
    temperature: 0.2,
    max_output_tokens: 250,
    store: false,
  });

  return { text: response.output_text.trim(), usage: response.usage };
}
