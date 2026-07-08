import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { activeSessionPath } from "../../../src/store/sqlite/db";
import { LocalStore } from "../../../src/store/store";

describe("LocalStore (sqlite)", () => {
  it("creates the database and runs migrations on open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");

    try {
      await LocalStore.open(dbPath);
      expect(existsSync(dbPath)).toBe(true);

      const sqlite = new Database(dbPath);
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as { name: string }[];
      sqlite.close();

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining(["session", "fact", "source", "conversation_item"]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists the active session pointer beside the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");

    try {
      const store = await LocalStore.open(dbPath);
      const pointer = readFileSync(activeSessionPath(dbPath), "utf8").trim();
      expect(pointer).toBe(store.sessionId);
      expect(dirname(activeSessionPath(dbPath))).toBe(dirname(dbPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reopens the same session from the active pointer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");

    try {
      const first = await LocalStore.open(dbPath);
      await first.fact.add("persistent fact");

      const second = await LocalStore.open(dbPath);
      expect(second.sessionId).toBe(first.sessionId);
      expect(await second.fact.list()).toEqual(["persistent fact"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
