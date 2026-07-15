import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, gt, inArray, ne, not, or, sql, type SQL } from "drizzle-orm";
import type { AgentEvent, AgentEventType } from "@/app/runner/thread/events";
import type { SqliteDb } from "@/store/db/db";
import { conversation, conversationItem } from "@/store/db/schema";
import {
  conversationLastActivity,
  conversationShape,
  rowToStored,
  transcriptItems,
  usageFromItems,
} from "./helpers";
import { asArray, type OneOrMany } from "../helpers";

export type ItemKind = AgentEventType | "summary";

export type TokenColumns = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  summarizerTokens: number;
};

export const ZERO_TOKENS: TokenColumns = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  summarizerTokens: 0,
};

export type ConversationItemInsert = {
  kind: ItemKind;
  turnIndex: number | null;
  payload: AgentEvent | { content: string };
  tokens?: Partial<TokenColumns> | undefined;
};

export type Conversation = {
  id: string;
  profileId: string;
  title: string;
  createdAt: number;
  lastActivityAt: number | null;
};

export type StoredItemRow = {
  id: number;
  conversationId: string;
  kind: string;
  turnIndex: number | null;
  payload: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  summarizerTokens: number;
  createdAt: number;
};

export class ConversationQuery {
  private readonly base;
  private readonly filters: SQL[] = [];
  private ordered = false;

  constructor(private readonly db: SqliteDb) {
    this.base = db.select(conversationShape()).from(conversation).$dynamic();
  }

  private filtered() {
    return this.filters.length ? this.base.where(and(...this.filters)) : this.base;
  }

  forProfile(profileId: string): this {
    this.filters.push(eq(conversation.profileId, profileId));
    return this;
  }

  byId(id: string): this {
    this.filters.push(eq(conversation.id, id));
    return this;
  }

  orderByLastActivity(): this {
    this.ordered = true;
    return this;
  }

  withAssistantReply(): this {
    this.filters.push(this.assistantReplyExists());
    return this;
  }

  withoutAssistantReply(): this {
    this.filters.push(not(this.assistantReplyExists()));
    return this;
  }

  items(): ConversationItemQuery {
    return new ConversationItemQuery(this.db);
  }

  execute(): Promise<Conversation[]> {
    let qb = this.filtered();
    qb = this.ordered
      ? qb.orderBy(desc(conversationLastActivity()), desc(conversation.createdAt))
      : qb.orderBy(desc(conversation.createdAt));
    return Promise.resolve(qb.all());
  }

  executeAndTakeFirst(): Promise<Conversation | null> {
    return Promise.resolve(this.filtered().get() ?? null);
  }

  private assistantReplyExists(): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(conversationItem)
        .where(
          and(
            eq(conversationItem.conversationId, conversation.id),
            eq(conversationItem.kind, "assistant_answer"),
          ),
        ),
    );
  }
}

export class ConversationItemQuery {
  private readonly base;
  private readonly filters: SQL[] = [];
  private desc = false;

  constructor(private readonly db: SqliteDb) {
    this.base = db.select().from(conversationItem).$dynamic();
  }

  private filtered() {
    return this.filters.length ? this.base.where(and(...this.filters)) : this.base;
  }

  forConversation(conversationId: string): this {
    this.filters.push(eq(conversationItem.conversationId, conversationId));
    return this;
  }

  withoutSummaries(): this {
    this.filters.push(ne(conversationItem.kind, "summary"));
    return this;
  }

  /** Every summary row, plus non-summary rows after the latest summary — the model window. */
  summariesOrAfter(boundary: number | null): this {
    if (boundary == null) return this;
    const cond = or(eq(conversationItem.kind, "summary"), gt(conversationItem.id, boundary));
    if (cond) this.filters.push(cond);
    return this;
  }

  afterItemId(id: number): this {
    this.filters.push(gt(conversationItem.id, id));
    return this;
  }

  ofKind(kind: string): this {
    this.filters.push(eq(conversationItem.kind, kind));
    return this;
  }

  orderByIdDesc(): this {
    this.desc = true;
    return this;
  }

  execute(): Promise<StoredItemRow[]> {
    const qb = this.desc
      ? this.filtered().orderBy(desc(conversationItem.id))
      : this.filtered().orderBy(conversationItem.id);
    return Promise.resolve(qb.all());
  }

  executeAndTakeFirst(): Promise<StoredItemRow | null> {
    const qb = this.desc
      ? this.filtered().orderBy(desc(conversationItem.id))
      : this.filtered().orderBy(conversationItem.id);
    return Promise.resolve(qb.get() ?? null);
  }
}

export type HistoryQueryConfig = {
  conversationId?: string;
  afterLastSummary: boolean;
  forModel?: boolean;
};

export class ConversationRepository {
  constructor(private readonly db: SqliteDb) {}

  query(): ConversationQuery {
    return new ConversationQuery(this.db);
  }

  items(): ConversationItemQuery {
    return new ConversationItemQuery(this.db);
  }

  createConversation(profileId: string, title = "New chat"): Conversation {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db.insert(conversation).values({ id, profileId, title, createdAt }).run();
    return { id, profileId, title, createdAt, lastActivityAt: null };
  }

  updateConversation(id: string, title: string): void {
    this.db.update(conversation).set({ title }).where(eq(conversation.id, id)).run();
  }

  deleteConversations(ids: string[]): void {
    if (!ids.length) return;
    this.db.transaction((tx) => {
      tx.delete(conversationItem).where(inArray(conversationItem.conversationId, ids)).run();
      tx.delete(conversation).where(inArray(conversation.id, ids)).run();
    });
  }

  transaction<T>(fn: (repo: ConversationRepository) => T): T {
    return this.db.transaction((tx) => fn(new ConversationRepository(tx as unknown as SqliteDb)));
  }

  insertItems(conversationId: string, items: OneOrMany<ConversationItemInsert>): void {
    const batch = asArray(items);
    if (!batch.length) return;
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const item of batch) {
        const tokens = {
          inputTokens: item.tokens?.inputTokens ?? 0,
          cachedInputTokens: item.tokens?.cachedInputTokens ?? 0,
          outputTokens: item.tokens?.outputTokens ?? 0,
          summarizerTokens: item.tokens?.summarizerTokens ?? 0,
        };
        tx.insert(conversationItem)
          .values({
            conversationId,
            turnIndex: item.turnIndex,
            kind: item.kind,
            payload: JSON.stringify(item.payload),
            inputTokens: tokens.inputTokens,
            cachedInputTokens: tokens.cachedInputTokens,
            outputTokens: tokens.outputTokens,
            summarizerTokens: tokens.summarizerTokens,
            createdAt: now,
          })
          .run();
      }
    });
  }

  async summaryBoundaryId(conversationId: string): Promise<number | null> {
    const row = await this.db
      .select({ id: conversationItem.id })
      .from(conversationItem)
      .where(
        and(
          eq(conversationItem.conversationId, conversationId),
          eq(conversationItem.kind, "summary"),
        ),
      )
      .orderBy(desc(conversationItem.id))
      .limit(1)
      .get();
    return row?.id ?? null;
  }

  usageTotals(conversationId: string) {
    return this.items()
      .forConversation(conversationId)
      .execute()
      .then((rows) => usageFromItems(rows.map((row) => rowToStored(row))));
  }

  async readLatestSummaryText(conversationId: string): Promise<string> {
    const row = await this.items()
      .forConversation(conversationId)
      .ofKind("summary")
      .orderByIdDesc()
      .executeAndTakeFirst();
    if (!row) return "";
    const payload = JSON.parse(row.payload) as { content: string };
    return payload.content ?? "";
  }

  async runHistoryQuery(conversationId: string, config: HistoryQueryConfig): Promise<AgentEvent[]> {
    const targetId = config.conversationId ?? conversationId;

    // The model window: every summary segment, then the messages after the last one.
    if (config.forModel) {
      const boundary = await this.summaryBoundaryId(targetId);
      const rows = await this.items()
        .forConversation(targetId)
        .summariesOrAfter(boundary)
        .execute();
      return transcriptItems(rows.map((row) => rowToStored(row)));
    }

    const boundary = config.afterLastSummary ? await this.summaryBoundaryId(targetId) : null;
    let query = this.items().forConversation(targetId).withoutSummaries();
    if (boundary != null) query = query.afterItemId(boundary);

    const rows = await query.execute();
    return transcriptItems(rows.map((row) => rowToStored(row)));
  }
}
