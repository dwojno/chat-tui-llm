import type { ConversationClient } from "./conversation/client";
import type { FactClient } from "./fact/client";
import type { SourcesClient } from "./sources/client";
import {
  openDatabase,
  readActiveSessionId,
  writeActiveSessionId,
  type SqliteDb,
} from "./sqlite/db";
import { SqliteConversationClient } from "./sqlite/conversation";
import { SqliteFactClient } from "./sqlite/fact";
import { SqliteSourcesClient } from "./sqlite/sources";
import { ensureActiveSession, listSessions } from "./sqlite/sessions";
import type { SessionMeta } from "./types";

const IN_MEMORY = ":memory:";

/**
 * Persistence seam for the agent + UI. Session and commands depend on this
 * facade and its namespaced clients — never on SQLite directly. A remote or
 * Postgres backend is a new `Store` implementation.
 */
export interface Store {
  readonly sessionId: string;
  readonly conversation: ConversationClient;
  readonly fact: FactClient;
  readonly sources: SourcesClient;
  listSessions(): Promise<SessionMeta[]>;
}

/**
 * SQLite-backed store. `open(path)` for the durable file backend;
 * `open(":memory:")` for an ephemeral database — used by tests so they exercise
 * the real SQL rather than a stand-in.
 */
export class LocalStore implements Store {
  readonly conversation: ConversationClient;
  readonly fact: FactClient;
  readonly sources: SourcesClient;

  private constructor(
    private readonly db: SqliteDb,
    readonly sessionId: string,
  ) {
    this.conversation = new SqliteConversationClient(db, sessionId);
    this.fact = new SqliteFactClient(db, sessionId);
    this.sources = new SqliteSourcesClient(db, sessionId);
  }

  static async open(dbPath: string): Promise<LocalStore> {
    const db = openDatabase(dbPath);
    const inMemory = dbPath === IN_MEMORY;
    // An in-memory database is per-connection and ephemeral, so the on-disk
    // active-session pointer doesn't apply — just start a fresh session.
    const sessionId = ensureActiveSession(db, inMemory ? null : readActiveSessionId(dbPath));
    if (!inMemory) writeActiveSessionId(dbPath, sessionId);
    return new LocalStore(db, sessionId);
  }

  async listSessions(): Promise<SessionMeta[]> {
    return listSessions(this.db);
  }
}
