import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import type { SqliteDb } from "../../db/db";
import { fact } from "../../db/schema";
import { asArray, type OneOrMany } from "../helpers";

export type Fact = {
  id: number;
  profileId: string;
  category: string;
  text: string;
  createdAt: number;
};

const factShape = {
  id: fact.id,
  profileId: fact.profileId,
  category: fact.category,
  text: fact.text,
  createdAt: fact.createdAt,
};

export class FactQuery {
  private qb;

  constructor(private readonly db: SqliteDb) {
    this.qb = db.select(factShape).from(fact).orderBy(fact.id).$dynamic();
  }

  forProfile(profileId: string): this {
    this.qb = this.qb.where(eq(fact.profileId, profileId));
    return this;
  }

  inCategory(category: string): this {
    this.qb = this.qb.where(eq(fact.category, category));
    return this;
  }

  execute(): Promise<Fact[]> {
    return Promise.resolve(this.qb.all());
  }

  executeAndTakeFirst(): Promise<Fact | null> {
    return Promise.resolve(this.qb.get() ?? null);
  }
}

export class FactRepository {
  constructor(private readonly db: SqliteDb) {}

  query(): FactQuery {
    return new FactQuery(this.db);
  }

  insert(profileId: string, text: string, category: string): Fact {
    const createdAt = Date.now();
    const row = this.db
      .insert(fact)
      .values({ profileId, category, text, createdAt })
      .returning()
      .get();
    assert(row !== undefined);
    return row;
  }

  update(id: number, patch: { text?: string; category?: string }): void {
    const values: Partial<typeof fact.$inferInsert> = {};
    if (patch.text !== undefined) values.text = patch.text;
    if (patch.category !== undefined) values.category = patch.category;
    if (!Object.keys(values).length) return;
    this.db.update(fact).set(values).where(eq(fact.id, id)).run();
  }

  delete(ids: OneOrMany<number>): void {
    const batch = asArray(ids);
    if (!batch.length) return;
    this.db.delete(fact).where(inArray(fact.id, batch)).run();
  }
}
