import { sql } from "drizzle-orm";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { countUserTurns, renderItemsText, splitAtLastTurns } from "../../agent/conversation";
import { SYSTEM_INSTRUCTIONS } from "../../agent/prompts";
import { estimateTokens } from "../../tokens";
import { conversation, conversationItem } from "../../db/schema";
import { type UsageTotals } from "../../integration/usage";

interface StoredItem {
  kind: string;
  turnIndex: number | null;
  payload: ResponseInputItem | { content: string };
  tokens: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    summarizerTokens: number;
  };
}

export function conversationLastActivity() {
  return sql<number | null>`(
    SELECT MAX(${conversationItem.createdAt})
    FROM ${conversationItem}
    WHERE ${conversationItem.conversationId} = ${conversation.id}
  )`.as("last_activity_at");
}

export const conversationShape = (lastActivityAt = conversationLastActivity()) => ({
  id: conversation.id,
  profileId: conversation.profileId,
  title: conversation.title,
  createdAt: conversation.createdAt,
  lastActivityAt,
});

export function rowToStored(row: {
  kind: string;
  turnIndex: number | null;
  payload: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  summarizerTokens: number;
}): StoredItem {
  return {
    kind: row.kind,
    turnIndex: row.turnIndex,
    payload: JSON.parse(row.payload) as ResponseInputItem | { content: string },
    tokens: {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      summarizerTokens: row.summarizerTokens,
    },
  };
}

export function transcriptItems(items: StoredItem[]): ResponseInputItem[] {
  return items.flatMap((row) => {
    if (row.kind === "summary") return [];
    return [row.payload as ResponseInputItem];
  });
}

export function windowFromTranscript(
  items: ResponseInputItem[],
  keepLastTurns: number,
): ResponseInputItem[] {
  return splitAtLastTurns(items, keepLastTurns).kept;
}

export function usageFromItems(items: StoredItem[], history: ResponseInputItem[]): UsageTotals {
  const totals: UsageTotals = {
    actualInput: 0,
    cachedInput: 0,
    output: 0,
    summarizer: 0,
    baselineInput: 0,
    turns: 0,
  };

  for (const row of items) {
    totals.actualInput += row.tokens.inputTokens;
    totals.cachedInput += row.tokens.cachedInputTokens;
    totals.output += row.tokens.outputTokens;
    totals.summarizer += row.tokens.summarizerTokens;
  }

  totals.turns = countUserTurns(history);

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
}) {
  return {
    inputTokens: usage.input_tokens ?? 0,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    summarizerTokens: 0,
  };
}

export function summaryDeveloperMessage(summary: string): ResponseInputItem {
  return {
    role: "developer",
    content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
  } satisfies ResponseInputItem;
}
