import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { UsageTotals } from "../../integration/usage";
import type { ConversationItemInsert } from "../types";
import { HistoryQuery, type HistoryQueryConfig } from "./query";

/** Transcript, rolling summaries, and token accounting for the active session. */
export abstract class ConversationClient {
  abstract getUsageTotals(): Promise<UsageTotals>;

  protected abstract runHistoryQuery(config: HistoryQueryConfig): Promise<ResponseInputItem[]>;

  /** Fluent transcript reads — UI replay, model window, overflow checks. */
  queryHistory(): HistoryQuery {
    return new HistoryQuery((config) => this.runHistoryQuery(config));
  }

  /** Latest rolling-summary text (empty if none). Used when folding the window. */
  abstract readLatestSummaryText(sessionId?: string): Promise<string>;

  abstract appendItem(item: ConversationItemInsert): Promise<void>;
  /** Append a batch atomically (a full turn's items) — SQLite wraps it in one transaction. */
  abstract appendItems(items: readonly ConversationItemInsert[]): Promise<void>;
}
