import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import type { SqliteDb } from "../../db/db";
import { memory } from "../../db/schema";
import { asArray, type OneOrMany } from "../helpers";

export type Memory = {
  id: number;
  profileId: string;
  category: string;
  text: string;
  createdAt: number;
};

const memoryShape = {
  id: memory.id,
  profileId: memory.profileId,
  category: memory.category,
  text: memory.text,
  createdAt: memory.createdAt,
};

export class MemoryQuery {
  private qb;

  constructor(private readonly db: SqliteDb) {
    this.qb = db.select(memoryShape).from(memory).orderBy(memory.id).$dynamic();
  }

  forProfile(profileId: string): this {
    this.qb = this.qb.where(eq(memory.profileId, profileId));
    return this;
  }

  inCategory(category: string): this {
    this.qb = this.qb.where(eq(memory.category, category));
    return this;
  }

  execute(): Promise<Memory[]> {
    return Promise.resolve(this.qb.all());
  }

  executeAndTakeFirst(): Promise<Memory | null> {
    return Promise.resolve(this.qb.get() ?? null);
  }
}

export class MemoryRepository {
  constructor(private readonly db: SqliteDb) {}

  query(): MemoryQuery {
    return new MemoryQuery(this.db);
  }

  insert(profileId: string, text: string, category: string): Memory {
    const createdAt = Date.now();
    const row = this.db
      .insert(memory)
      .values({ profileId, category, text, createdAt })
      .returning()
      .get();
    assert(row !== undefined);
    return row;
  }

  update(id: number, patch: { text?: string; category?: string }): void {
    const values: Partial<typeof memory.$inferInsert> = {};
    if (patch.text !== undefined) values.text = patch.text;
    if (patch.category !== undefined) values.category = patch.category;
    if (!Object.keys(values).length) return;
    this.db.update(memory).set(values).where(eq(memory.id, id)).run();
  }

  delete(ids: OneOrMany<number>): void {
    const batch = asArray(ids);
    if (!batch.length) return;
    this.db.delete(memory).where(inArray(memory.id, batch)).run();
  }
}
