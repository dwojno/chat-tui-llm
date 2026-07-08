import { eq } from "drizzle-orm";
import { FactClient } from "../fact/client";
import type { SqliteDb } from "./db";
import { fact } from "./schema";

export class SqliteFactClient extends FactClient {
  constructor(
    private readonly db: SqliteDb,
    private readonly sessionId: string,
  ) {
    super();
  }

  async add(text: string, category = "general"): Promise<void> {
    this.db
      .insert(fact)
      .values({ sessionId: this.sessionId, category, text, createdAt: Date.now() })
      .run();
  }

  async list(): Promise<string[]> {
    return this.db
      .select({ text: fact.text })
      .from(fact)
      .where(eq(fact.sessionId, this.sessionId))
      .orderBy(fact.id)
      .all()
      .map((row) => row.text);
  }
}
