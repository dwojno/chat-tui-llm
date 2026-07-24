import assert from "node:assert";
import { sql } from "drizzle-orm";
import type { AgentEvent } from "@chat/agent";
import { buildMessage } from "@/app/runner/thread/reducer";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { estimateTokens } from "@/app/tokens";
import type { UsageRecord } from "@chat/platform/model";
import { conversation, conversationItem } from "@/store/db/schema";
import { type UsageTotals } from "@/app/session/usage";

interface StoredItem {
  kind: string;
  turnIndex: number | null;
  payload: AgentEvent | { content: string };
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
}): StoredItem {
  return {
    kind: row.kind,
    turnIndex: row.turnIndex,
    payload: JSON.parse(row.payload) as AgentEvent | { content: string },
  };
}

export function transcriptItems(items: StoredItem[]): AgentEvent[] {
  return items.map((row) =>
    row.kind === "summary"
      ? { type: "summary", content: (row.payload as { content: string }).content }
      : (row.payload as AgentEvent),
  );
}

const MODEL_OUTPUT_KINDS = new Set<string>([
  "assistant_answer",
  "tool_call",
  "clarification_request",
  "scratchpad",
]);

const isModelOutput = (kind: string, payload: AgentEvent, toolCallIds: Set<string>): boolean => {
  if (MODEL_OUTPUT_KINDS.has(kind)) return true;
  return kind === "error" && "id" in payload && !toolCallIds.has(payload.id);
};

const asAgentEvent = (row: StoredItem): AgentEvent =>
  row.kind === "summary"
    ? { type: "summary", content: (row.payload as { content: string }).content }
    : (row.payload as AgentEvent);

function managedView(prefix: readonly AgentEvent[]): AgentEvent[] {
  let lastSummary = -1;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i]?.type === "summary") lastSummary = i;
  }
  if (lastSummary < 0) return [...prefix];
  const summaries = prefix.filter((event) => event.type === "summary");
  return [...summaries, ...prefix.slice(lastSummary + 1)];
}

function promptTokens(events: readonly AgentEvent[]): number {
  const [message] = buildMessage({ events });
  assert(message && "content" in message);
  return estimateTokens(
    typeof message.content === "string" ? message.content : JSON.stringify(message.content),
  );
}

export function usageFromRecords(
  records: readonly UsageRecord[],
  items: readonly StoredItem[],
): UsageTotals {
  const totals: UsageTotals = {
    actualInput: 0,
    cachedInput: 0,
    output: 0,
    summarizer: 0,
    forkInput: 0,
    managedInput: 0,
    baselineInput: 0,
    turns: 0,
  };

  for (const record of records) {
    if (record.kind === "summarizer") {
      totals.summarizer += record.inputTokens + record.outputTokens;
      continue;
    }
    totals.actualInput += record.inputTokens;
    totals.cachedInput += record.cachedInputTokens;
    totals.output += record.outputTokens;
    if (record.kind === "fork" || record.kind === "handoff") {
      totals.forkInput += record.inputTokens;
    }
  }

  for (const row of items) {
    if (row.kind === "user_message") totals.turns += 1;
  }

  const toolCallIds = new Set<string>();
  for (const row of items) {
    if (row.kind === "tool_call" && "id" in row.payload) toolCallIds.add(row.payload.id);
  }

  // ponytail: O(n²) — buildMessage re-packs the growing prefix per model call, recomputed on
  // every read (incl. live-bar refresh that only needs the snapshot). Fine at CLI scale; cache
  // baseline/managed per conversation if transcripts ever get large.
  const systemTokens = estimateTokens(SYSTEM_INSTRUCTIONS);
  const prefix: AgentEvent[] = [];
  let modelCallPending = true;
  for (const row of items) {
    const payload = asAgentEvent(row);
    if (isModelOutput(row.kind, payload, toolCallIds)) {
      if (modelCallPending) {
        const naive = prefix.filter((event) => event.type !== "summary");
        totals.baselineInput += systemTokens + promptTokens(naive);
        totals.managedInput += systemTokens + promptTokens(managedView(prefix));
        modelCallPending = false;
      }
      prefix.push(payload);
    } else {
      prefix.push(payload);
      if (row.kind !== "approval_request" && row.kind !== "approval_response") {
        modelCallPending = true;
      }
    }
  }

  return totals;
}

/** @deprecated Prefer usageFromRecords — kept for baseline-only unit tests. */
export function usageFromItems(items: StoredItem[]): UsageTotals {
  return usageFromRecords([], items);
}
