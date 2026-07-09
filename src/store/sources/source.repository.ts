import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import type { SqliteDb } from "../../db/db";
import { source } from "../../db/schema";
import { asArray, type OneOrMany } from "../helpers";

export type Source = {
  id: number;
  profileId: string;
  path: string;
  createdAt: number;
};

const sourceShape = {
  id: source.id,
  profileId: source.profileId,
  path: source.path,
  createdAt: source.createdAt,
};

export class SourceQuery {
  private qb;

  constructor(private readonly db: SqliteDb) {
    this.qb = db.select(sourceShape).from(source).orderBy(source.id).$dynamic();
  }

  forProfile(profileId: string): this {
    this.qb = this.qb.where(eq(source.profileId, profileId));
    return this;
  }

  execute(): Promise<Source[]> {
    return Promise.resolve(this.qb.all());
  }

  executeAndTakeFirst(): Promise<Source | null> {
    return Promise.resolve(this.qb.get() ?? null);
  }
}

export class SourceRepository {
  constructor(private readonly db: SqliteDb) {}

  query(): SourceQuery {
    return new SourceQuery(this.db);
  }

  insert(profileId: string, path: string): Source {
    const createdAt = Date.now();
    const row = this.db.insert(source).values({ profileId, path, createdAt }).returning().get();
    assert(row !== undefined);
    return row;
  }

  update(id: number, path: string): void {
    this.db.update(source).set({ path }).where(eq(source.id, id)).run();
  }

  delete(ids: OneOrMany<number>): void {
    const batch = asArray(ids);
    if (!batch.length) return;
    this.db.delete(source).where(inArray(source.id, batch)).run();
  }

  transaction<T>(fn: (repo: SourceRepository) => T): T {
    return this.db.transaction((tx) => fn(new SourceRepository(tx as unknown as SqliteDb)));
  }

  insertMany(profileId: string, paths: string[]): Source[] {
    return this.transaction((repo) => paths.map((path) => repo.insert(profileId, path)));
  }
}
