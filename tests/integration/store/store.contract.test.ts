import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { LocalStore, type Store } from "../../../src/store/store";
import type { SessionMeta } from "../../../src/store/types";

export function storeContract(name: string, createStore: () => Promise<Store>): void {
  describe(`Store contract (${name})`, () => {
    it("starts empty", async () => {
      const store = await createStore();
      expect(await store.fact.list()).toEqual([]);
      expect(await store.sources.list()).toEqual([]);
      expect(await store.conversation.queryHistory().execute()).toEqual([]);
      expect(await store.conversation.queryHistory().lastTurns(4).execute()).toEqual([]);
    });

    it("appends transcript items and returns them in history", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "hello" },
      });
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "assistant", content: "hi there" },
      });

      expect(await store.conversation.queryHistory().execute()).toEqual([
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ]);
    });

    it("appends a batch atomically and returns it in history", async () => {
      const store = await createStore();
      await store.conversation.appendItems([
        { kind: "message", turnIndex: 0, payload: { role: "user", content: "batch q" } },
        { kind: "message", turnIndex: 0, payload: { role: "assistant", content: "batch a" } },
      ]);

      expect(await store.conversation.queryHistory().execute()).toEqual([
        { role: "user", content: "batch q" },
        { role: "assistant", content: "batch a" },
      ]);
    });

    it("caps to the last N user turns with lastTurns", async () => {
      const store = await createStore();
      for (let turn = 0; turn < 5; turn++) {
        await store.conversation.appendItem({
          kind: "message",
          turnIndex: turn,
          payload: { role: "user", content: `q${turn}` },
        });
        await store.conversation.appendItem({
          kind: "message",
          turnIndex: turn,
          payload: { role: "assistant", content: `a${turn}` },
        });
      }

      const window = await store.conversation.queryHistory().lastTurns(2).execute();
      const userMessages = window.filter(
        (item: ResponseInputItem) => "role" in item && item.role === "user",
      );
      expect(userMessages).toHaveLength(2);
      expect(userMessages[0]).toMatchObject({ content: "q3" });
      expect(userMessages[1]).toMatchObject({ content: "q4" });
    });

    it("never returns summary items in UI history", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "hi" },
      });
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
        tokens: { summarizerTokens: 10 },
      });

      expect(await store.conversation.queryHistory().execute()).toEqual([
        { role: "user", content: "hi" },
      ]);
    });

    it("drops already-summarized items with afterLastSummary", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "old" },
      });
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
        tokens: { summarizerTokens: 5 },
      });
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 1,
        payload: { role: "user", content: "new" },
      });

      expect(await store.conversation.queryHistory().execute()).toEqual([
        { role: "user", content: "old" },
        { role: "user", content: "new" },
      ]);
      expect(await store.conversation.queryHistory().afterLastSummary().execute()).toEqual([
        { role: "user", content: "new" },
      ]);
    });

    it("scopes history by session id", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "hi" },
      });

      expect(await store.conversation.queryHistory().forSession(store.sessionId).execute()).toEqual(
        [{ role: "user", content: "hi" }],
      );
      expect(
        await store.conversation.queryHistory().forSession("does-not-exist").execute(),
      ).toEqual([]);
    });

    it("forModel prepends the latest summary once and excludes evicted items", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "old" },
      });
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
        tokens: { summarizerTokens: 5 },
      });
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 1,
        payload: { role: "user", content: "new" },
      });

      const modelInput = await store.conversation
        .queryHistory()
        .forModel({ lastTurns: 4 })
        .execute();

      expect(modelInput).toHaveLength(2);
      expect(modelInput[0]).toMatchObject({
        role: "developer",
        content: expect.stringContaining("rolled up"),
      });
      expect(modelInput[1]).toMatchObject({ role: "user", content: "new" });
      expect(
        modelInput.some((item) => "role" in item && item.role === "user" && item.content === "old"),
      ).toBe(false);
    });

    it("forModel returns tail only when there is no summary row", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "hi" },
      });

      expect(await store.conversation.queryHistory().forModel({ lastTurns: 4 }).execute()).toEqual([
        { role: "user", content: "hi" },
      ]);
    });

    it("readLatestSummaryText returns the latest summary", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "first" },
      });
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "second" },
      });

      expect(await store.conversation.readLatestSummaryText()).toBe("second");
    });

    it("accumulates token usage via anchor rows", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "user", content: "hi" },
      });
      await store.conversation.appendItem({
        kind: "message",
        turnIndex: 0,
        payload: { role: "assistant", content: "hello" },
        tokens: { inputTokens: 100, cachedInputTokens: 10, outputTokens: 50 },
      });

      const totals = await store.conversation.getUsageTotals();
      expect(totals.actualInput).toBe(100);
      expect(totals.cachedInput).toBe(10);
      expect(totals.output).toBe(50);
      expect(totals.turns).toBe(1);
    });

    it("includes summarizer tokens in usage totals", async () => {
      const store = await createStore();
      await store.conversation.appendItem({
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
        tokens: { summarizerTokens: 42 },
      });

      const totals = await store.conversation.getUsageTotals();
      expect(totals.summarizer).toBe(42);
    });

    it("deduplicates sources", async () => {
      const store = await createStore();
      expect(await store.sources.add(["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"]);
      expect(await store.sources.add(["b.ts", "c.ts"])).toEqual(["c.ts"]);
      expect(await store.sources.list()).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    it("stores facts in order", async () => {
      const store = await createStore();
      await store.fact.add("likes tea");
      await store.fact.add("uses vim");

      expect(await store.fact.list()).toEqual(["likes tea", "uses vim"]);
    });

    it("lists the active session", async () => {
      const store = await createStore();
      const sessions = await store.listSessions();
      expect(sessions.some((entry: SessionMeta) => entry.id === store.sessionId)).toBe(true);
    });
  });
}

storeContract("sqlite :memory:", async () => LocalStore.open(":memory:"));

storeContract("sqlite file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-cli-contract-"));
  return LocalStore.open(join(dir, "chat.db"));
});
