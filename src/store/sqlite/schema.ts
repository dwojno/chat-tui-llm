import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New chat"),
  createdAt: integer("created_at").notNull(),
});

export const fact = sqliteTable("fact", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id),
  category: text("category").notNull().default("general"),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const source = sqliteTable(
  "source",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id),
    path: text("path").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("source_session_path").on(table.sessionId, table.path)],
);

export const conversationItem = sqliteTable(
  "conversation_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id),
    turnIndex: integer("turn_index"),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    summarizerTokens: integer("summarizer_tokens").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("conversation_item_session_turn").on(table.sessionId, table.turnIndex),
    index("conversation_item_session_kind_id").on(table.sessionId, table.kind, table.id),
  ],
);
