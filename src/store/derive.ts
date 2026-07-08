import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { countUserTurns, renderItemsText, splitAtLastTurns } from "../agent/conversation";
import { SYSTEM_INSTRUCTIONS } from "../agent/prompts";
import { estimateTokens } from "../agent/tokens";
import { EMPTY_USAGE, type UsageTotals } from "../integration/usage";
import type { TokenColumns } from "./types";

interface StoredItem {
  kind: string;
  turnIndex: number | null;
  payload: ResponseInputItem | { content: string };
  tokens: TokenColumns;
}

export function payloadToInputItem(
  kind: string,
  payload: ResponseInputItem | { content: string },
): ResponseInputItem | null {
  if (kind === "summary") return null;
  return payload as ResponseInputItem;
}

export function transcriptItems(items: readonly StoredItem[]): ResponseInputItem[] {
  return items.flatMap((row) => {
    const item = payloadToInputItem(row.kind, row.payload);
    return item ? [item] : [];
  });
}

export function windowFromTranscript(
  items: readonly ResponseInputItem[],
  keepLastTurns: number,
): ResponseInputItem[] {
  const { kept } = splitAtLastTurns([...items], keepLastTurns);
  return kept;
}

export function usageFromItems(
  items: readonly StoredItem[],
  history: readonly ResponseInputItem[],
): UsageTotals {
  const totals = { ...EMPTY_USAGE };

  for (const row of items) {
    totals.actualInput += row.tokens.inputTokens;
    totals.cachedInput += row.tokens.cachedInputTokens;
    totals.output += row.tokens.outputTokens;
    totals.summarizer += row.tokens.summarizerTokens;
  }

  totals.turns = countUserTurns([...history]);

  let turnText = "";
  for (const item of history) {
    turnText += renderItemsText([item]);
    if ("role" in item && item.role === "user") {
      totals.baselineInput += estimateTokens(turnText) + estimateTokens(SYSTEM_INSTRUCTIONS);
      turnText = "";
    }
  }
  if (turnText) {
    totals.baselineInput += estimateTokens(turnText) + estimateTokens(SYSTEM_INSTRUCTIONS);
  }

  return totals;
}

export function responseUsageToTokens(usage: {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}): TokenColumns {
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    summarizerTokens: 0,
  };
}

export function summarizerUsageToTokens(totalTokens: number): TokenColumns {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    summarizerTokens: totalTokens,
  };
}
