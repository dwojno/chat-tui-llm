import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import type { Source, SourceIndexPatch, SourceQuery as SourceQueryContract } from "@chat/store";
import type { SqliteDb } from "@/store/db/db";
import { source } from "@/store/db/schema";
import { asArray, type OneOrMany } from "../helpers";

const sourceShape = {
  id: source.id,
  profileId: source.profileId,
  path: source.path,
  status: source.status,
  s3Key: source.s3Key,
  contentHash: source.contentHash,
  chunkCount: source.chunkCount,
  indexedAt: source.indexedAt,
  createdAt: source.createdAt,
};

export class SourceQuery implements SourceQueryContract {
  private qb;

  constructor(private readonly db: SqliteDb) {
    this.qb = db.select(sourceShape).from(source).orderBy(source.id).$dynamic();
  }

  forProfile(profileId: string): this {
    this.qb = this.qb.where(eq(source.profileId, profileId));
    return this;
  }

  execute(): Promise<Source[]> {
    return Promise.resolve(this.qb.all() as Source[]);
  }

  executeAndTakeFirst(): Promise<Source | null> {
    return Promise.resolve((this.qb.get() as Source | undefined) ?? null);
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
    return row as Source;
  }

  update(id: number, path: string): void {
    this.db.update(source).set({ path }).where(eq(source.id, id)).run();
  }

  getByPath(profileId: string, path: string): Source | null {
    const row = this.db
      .select()
      .from(source)
      .where(and(eq(source.profileId, profileId), eq(source.path, path)))
      .get();
    return (row as Source | undefined) ?? null;
  }

  markIndexed(id: number, patch: SourceIndexPatch): void {
    this.db.update(source).set(patch).where(eq(source.id, id)).run();
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
