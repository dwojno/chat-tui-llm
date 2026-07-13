import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { LocalStore } from "../../../src/store";

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
        expect.arrayContaining([
          "profile",
          "conversation",
          "memory",
          "source",
          "conversation_item",
        ]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists the active profile pointer beside the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");
    const activePath = join(dirname(dbPath), "active.json");

    try {
      const store = await LocalStore.open(dbPath);
      const pointer = JSON.parse(readFileSync(activePath, "utf8")) as {
        profileId: string;
      };
      expect(pointer.profileId).toBe(store.profileId);
      expect(dirname(activePath)).toBe(dirname(dbPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reopens with the same profile and preserves profile-scoped facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");

    try {
      const first = await LocalStore.open(dbPath);
      await first.memory.create(first.profileId, "persistent fact");

      const second = await LocalStore.open(dbPath);
      expect(second.profileId).toBe(first.profileId);
      expect(await second.memory.query().forProfile(second.profileId).execute()).toEqual([
        expect.objectContaining({ text: "persistent fact" }),
      ]);
      // Each open starts a fresh conversation (profile is restored, session is not).
      expect(second.conversationId).not.toBe(first.conversationId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores a conversation by id and derives the profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "chat-cli-sqlite-"));
    const dbPath = join(dir, "chat.db");

    try {
      const first = await LocalStore.open(dbPath);
      const { conversationId, profileId } = first;
      await first.conversation.createItems(conversationId, {
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "restore me" },
      });

      const restored = await LocalStore.open(dbPath, { conversationId });
      expect(restored.conversationId).toBe(conversationId);
      expect(restored.profileId).toBe(profileId);
      expect(await restored.conversation.queryHistory(conversationId).execute()).toEqual([
        { role: "user", content: "restore me" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
