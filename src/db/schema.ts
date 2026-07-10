import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profile = sqliteTable("profile", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model"),
  createdAt: integer("created_at").notNull(),
});

export const conversation = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  profileId: text("profile_id")
    .notNull()
    .references(() => profile.id),
  title: text("title").notNull().default("New chat"),
  createdAt: integer("created_at").notNull(),
});

export const memory = sqliteTable("memory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id")
    .notNull()
    .references(() => profile.id),
  category: text("category").notNull().default("general"),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const source = sqliteTable(
  "source",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profile.id),
    path: text("path").notNull(),
    status: text("status").notNull().default("pending"),
    s3Key: text("s3_key"),
    contentHash: text("content_hash"),
    chunkCount: integer("chunk_count"),
    indexedAt: integer("indexed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("source_profile_path").on(table.profileId, table.path)],
);

export const conversationItem = sqliteTable(
  "conversation_item",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversation.id),
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
    index("conversation_item_conversation_turn").on(table.conversationId, table.turnIndex),
    index("conversation_item_conversation_kind_id").on(table.conversationId, table.kind, table.id),
  ],
);
