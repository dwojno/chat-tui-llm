import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export type SqliteDb = ReturnType<typeof openDatabase>;

export function openDatabase(dbPath: string) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
