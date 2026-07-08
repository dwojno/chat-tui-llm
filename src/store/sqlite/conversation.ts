import { and, desc, eq, gt, max, ne } from "drizzle-orm";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { UsageTotals } from "../../integration/usage";
import { ConversationClient } from "../conversation/client";
import { HistoryQueryConfig, summaryDeveloperMessage } from "../conversation/query";
import { transcriptItems, usageFromItems, windowFromTranscript } from "../derive";
import type { ConversationItemInsert, TokenColumns } from "../types";
import type { SqliteDb } from "./db";
import { conversationItem } from "./schema";

interface StoredRow {
  kind: string;
  turnIndex: number | null;
  payload: ResponseInputItem | { content: string };
  tokens: TokenColumns;
}

export class SqliteConversationClient extends ConversationClient {
  constructor(
    private readonly db: SqliteDb,
    private readonly sessionId: string,
  ) {
    super();
  }

  async getUsageTotals(): Promise<UsageTotals> {
    const rows = this.db
      .select()
      .from(conversationItem)
      .where(eq(conversationItem.sessionId, this.sessionId))
      .orderBy(conversationItem.id)
      .all();

    const stored = rows.map((row) => this.rowToStored(row));
    const history = transcriptItems(stored.filter((row) => row.kind !== "summary"));
    return usageFromItems(stored, history);
  }

  async readLatestSummaryText(sessionId = this.sessionId): Promise<string> {
    const row = this.db
      .select({ payload: conversationItem.payload })
      .from(conversationItem)
      .where(and(eq(conversationItem.sessionId, sessionId), eq(conversationItem.kind, "summary")))
      .orderBy(desc(conversationItem.id))
      .limit(1)
      .get();

    if (!row) return "";
    const payload = this.parsePayload(row.payload) as { content: string };
    return payload.content ?? "";
  }

  protected async runHistoryQuery(config: HistoryQueryConfig): Promise<ResponseInputItem[]> {
    const sessionId = config.sessionId ?? this.sessionId;
    const tailItems = await this.fetchTranscriptItems(sessionId, config);

    if (!config.forModel) return tailItems;

    const summaryText = await this.readLatestSummaryText(sessionId);
    if (!summaryText) return tailItems;

    return [summaryDeveloperMessage(summaryText), ...tailItems];
  }

  private async fetchTranscriptItems(
    sessionId: string,
    config: HistoryQueryConfig,
  ): Promise<ResponseInputItem[]> {
    const conditions = [
      eq(conversationItem.sessionId, sessionId),
      ne(conversationItem.kind, "summary"),
    ];

    if (config.afterLastSummary) {
      const boundary = this.db
        .select({ id: max(conversationItem.id) })
        .from(conversationItem)
        .where(and(eq(conversationItem.sessionId, sessionId), eq(conversationItem.kind, "summary")))
        .get();
      if (boundary?.id != null) conditions.push(gt(conversationItem.id, boundary.id));
    }

    const rows = this.db
      .select()
      .from(conversationItem)
      .where(and(...conditions))
      .orderBy(conversationItem.id)
      .all();

    const items = transcriptItems(rows.map((row) => this.rowToStored(row)));
    return config.lastTurns === undefined ? items : windowFromTranscript(items, config.lastTurns);
  }

  async appendItem(item: ConversationItemInsert): Promise<void> {
    this.db.insert(conversationItem).values(this.itemValues(item, Date.now())).run();
  }

  async appendItems(items: readonly ConversationItemInsert[]): Promise<void> {
    if (!items.length) return;
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const item of items) {
        tx.insert(conversationItem).values(this.itemValues(item, now)).run();
      }
    });
  }

  private itemValues(item: ConversationItemInsert, createdAt: number) {
    const tokens = this.tokensFromInsert(item.tokens);
    return {
      sessionId: this.sessionId,
      turnIndex: item.turnIndex,
      kind: item.kind,
      payload: JSON.stringify(item.payload),
      inputTokens: tokens.inputTokens,
      cachedInputTokens: tokens.cachedInputTokens,
      outputTokens: tokens.outputTokens,
      summarizerTokens: tokens.summarizerTokens,
      createdAt,
    };
  }

  private parsePayload(raw: string): ResponseInputItem | { content: string } {
    return JSON.parse(raw) as ResponseInputItem | { content: string };
  }

  private rowToStored(row: {
    kind: string;
    turnIndex: number | null;
    payload: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    summarizerTokens: number;
  }): StoredRow {
    return {
      kind: row.kind,
      turnIndex: row.turnIndex,
      payload: this.parsePayload(row.payload),
      tokens: {
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
        summarizerTokens: row.summarizerTokens,
      },
    };
  }

  private tokensFromInsert(tokens?: Partial<TokenColumns>): TokenColumns {
    return {
      inputTokens: tokens?.inputTokens ?? 0,
      cachedInputTokens: tokens?.cachedInputTokens ?? 0,
      outputTokens: tokens?.outputTokens ?? 0,
      summarizerTokens: tokens?.summarizerTokens ?? 0,
    };
  }
}
