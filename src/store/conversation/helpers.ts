import { sql } from "drizzle-orm";
import type { AgentEvent } from "../../runner/thread/events";
import { SYSTEM_INSTRUCTIONS } from "../../agent/prompts";
import { estimateTokens } from "../../tokens";
import { conversation, conversationItem } from "../../db/schema";
import { type UsageTotals } from "../../integration/usage";

interface StoredItem {
  kind: string;
  turnIndex: number | null;
  payload: AgentEvent | { content: string };
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
    payload: JSON.parse(row.payload) as AgentEvent | { content: string },
    tokens: {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      summarizerTokens: row.summarizerTokens,
    },
  };
}

export function transcriptItems(items: StoredItem[]): AgentEvent[] {
  return items.map((row) =>
    row.kind === "summary"
      ? { type: "summary", content: (row.payload as { content: string }).content }
      : (row.payload as AgentEvent),
  );
}

export function usageFromItems(items: StoredItem[]): UsageTotals {
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
    if (row.kind === "user_message") totals.turns += 1;
  }

  let turnText = "";
  for (const row of items) {
    if (row.kind === "summary") continue;
    turnText += JSON.stringify(row.payload);
    if (row.kind === "user_message") {
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
