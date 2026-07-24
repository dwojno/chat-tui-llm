import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, gt, inArray, ne, not, or, sql, type SQL } from "drizzle-orm";
import type { AgentEvent } from "@chat/agent";
import type { UsageRecord } from "@chat/platform/model";
import type {
  Conversation,
  ConversationItemInsert,
  ConversationItemQuery as ConversationItemQueryContract,
  ConversationQuery as ConversationQueryContract,
  HistoryQueryConfig,
  StoredItemRow,
} from "@chat/store";
import type { SqliteDb } from "@/backend/db/db";
import { conversation, conversationItem, usageRecord } from "@/backend/db/schema";
import {
  conversationLastActivity,
  conversationShape,
  rowToStored,
  transcriptItems,
  usageFromRecords,
} from "./helpers";
import { asArray, type OneOrMany } from "../helpers";

export class ConversationQuery implements ConversationQueryContract {
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

export class ConversationItemQuery implements ConversationItemQueryContract {
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
      tx.delete(usageRecord).where(inArray(usageRecord.conversationId, ids)).run();
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
        tx.insert(conversationItem)
          .values({
            conversationId,
            turnIndex: item.turnIndex,
            kind: item.kind,
            payload: JSON.stringify(item.payload),
            createdAt: now,
          })
          .run();
      }
    });
  }

  insertUsage(conversationId: string, records: OneOrMany<UsageRecord>): void {
    const batch = asArray(records);
    if (!batch.length) return;
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const record of batch) {
        tx.insert(usageRecord)
          .values({
            conversationId,
            kind: record.kind,
            model: record.model,
            inputTokens: record.inputTokens,
            cachedInputTokens: record.cachedInputTokens,
            outputTokens: record.outputTokens,
            createdAt: now,
          })
          .run();
      }
    });
  }

  listUsage(conversationId: string): Promise<UsageRecord[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(usageRecord)
        .where(eq(usageRecord.conversationId, conversationId))
        .orderBy(usageRecord.id)
        .all()
        .map((row) => ({
          kind: row.kind as UsageRecord["kind"],
          model: row.model,
          inputTokens: row.inputTokens,
          cachedInputTokens: row.cachedInputTokens,
          outputTokens: row.outputTokens,
        })),
    );
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

  async usageTotals(conversationId: string) {
    const [records, rows] = await Promise.all([
      this.listUsage(conversationId),
      this.items().forConversation(conversationId).execute(),
    ]);
    return usageFromRecords(
      records,
      rows.map((row) => rowToStored(row)),
    );
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
