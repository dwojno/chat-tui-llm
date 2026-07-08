import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { SessionMeta } from "../types";
import type { SqliteDb } from "./db";
import { conversationItem, session } from "./schema";

/** Resolve the active session from the pointer, creating a fresh one if needed. */
export function ensureActiveSession(db: SqliteDb, sessionId: string | null): string {
  if (sessionId) {
    const existing = db.select().from(session).where(eq(session.id, sessionId)).get();
    if (existing) return sessionId;
  }

  const id = randomUUID();
  db.insert(session).values({ id, title: "New chat", createdAt: Date.now() }).run();
  return id;
}

export function listSessions(db: SqliteDb): SessionMeta[] {
  const lastActivityAt = sql<number | null>`(
    SELECT MAX(${conversationItem.createdAt})
    FROM ${conversationItem}
    WHERE ${conversationItem.sessionId} = ${session.id}
  )`.as("last_activity_at");

  return db
    .select({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      lastActivityAt,
    })
    .from(session)
    .orderBy(desc(lastActivityAt), desc(session.createdAt))
    .all();
}
