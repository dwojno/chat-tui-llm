import { eq } from "drizzle-orm";
import { SourcesClient } from "../sources/client";
import type { SqliteDb } from "./db";
import { source } from "./schema";

export class SqliteSourcesClient extends SourcesClient {
  constructor(
    private readonly db: SqliteDb,
    private readonly sessionId: string,
  ) {
    super();
  }

  async add(paths: readonly string[]): Promise<string[]> {
    const existing = new Set(await this.list());
    const added: string[] = [];
    const now = Date.now();

    this.db.transaction((tx) => {
      for (const path of paths) {
        if (existing.has(path)) continue;
        tx.insert(source).values({ sessionId: this.sessionId, path, createdAt: now }).run();
        existing.add(path);
        added.push(path);
      }
    });

    return added;
  }

  async list(): Promise<string[]> {
    return this.db
      .select({ path: source.path })
      .from(source)
      .where(eq(source.sessionId, this.sessionId))
      .orderBy(source.id)
      .all()
      .map((row) => row.path);
  }
}
