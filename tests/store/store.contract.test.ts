import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStore, type ConversationMeta, type Store } from "@/store";

const userMsg = (content: string, turn = 0) => ({
  kind: "user_message" as const,
  turnIndex: turn,
  payload: { type: "user_message" as const, content },
});

const assistantMsg = (content: string, turn = 0) => ({
  kind: "assistant_answer" as const,
  turnIndex: turn,
  payload: { type: "assistant_answer" as const, content },
});

const summary = (content: string) => ({
  kind: "summary" as const,
  turnIndex: null,
  payload: { type: "summary" as const, content },
});

async function addSources(
  store: Store,
  profileId: string,
  paths: readonly string[],
): Promise<string[]> {
  const existing = new Set(
    (await store.sources.query().forProfile(profileId).execute()).map((row) => row.path),
  );
  const added: string[] = [];
  for (const path of paths) {
    if (existing.has(path)) continue;
    await store.sources.create(profileId, path);
    existing.add(path);
    added.push(path);
  }
  return added;
}

export function storeContract(name: string, createStore: () => Promise<Store>): void {
  describe(`Store contract (${name})`, () => {
    it("starts empty", async () => {
      const store = await createStore();
      expect(await store.memory.query().forProfile(store.profileId).execute()).toEqual([]);
      expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual([]);
      expect(await store.conversation.queryHistory(store.conversationId).execute()).toEqual([]);
    });

    it("appends transcript events and returns them in history", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("hello"));
      await store.conversation.createItems(conversationId, assistantMsg("hi there"));

      expect(await store.conversation.queryHistory(conversationId).execute()).toEqual([
        { type: "user_message", content: "hello" },
        { type: "assistant_answer", content: "hi there" },
      ]);
    });

    it("appends a batch atomically and returns it in history", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, [
        userMsg("batch q"),
        assistantMsg("batch a"),
      ]);

      expect(await store.conversation.queryHistory(conversationId).execute()).toEqual([
        { type: "user_message", content: "batch q" },
        { type: "assistant_answer", content: "batch a" },
      ]);
    });

    it("never returns summary items in UI history", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("hi"));
      await store.conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
      });

      expect(await store.conversation.queryHistory(conversationId).execute()).toEqual([
        { type: "user_message", content: "hi" },
      ]);
    });

    it("drops already-summarized items with afterLastSummary", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("old"));
      await store.conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
      });
      await store.conversation.createItems(conversationId, userMsg("new", 1));

      expect(await store.conversation.queryHistory(conversationId).execute()).toEqual([
        { type: "user_message", content: "old" },
        { type: "user_message", content: "new" },
      ]);
      expect(
        await store.conversation.queryHistory(conversationId).afterLastSummary().execute(),
      ).toEqual([{ type: "user_message", content: "new" }]);
    });

    it("scopes history by conversation id", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("hi"));

      expect(
        await store.conversation
          .queryHistory(conversationId)
          .forConversation(conversationId)
          .execute(),
      ).toEqual([{ type: "user_message", content: "hi" }]);
      expect(
        await store.conversation
          .queryHistory(conversationId)
          .forConversation("does-not-exist")
          .execute(),
      ).toEqual([]);
    });

    it("forModel returns every summary segment plus the messages after the last one", async () => {
      const store = await createStore();
      const { conversationId } = store;
      // [m1, m2, m3, summary1, mN, summary2, mNx]
      await store.conversation.createItems(conversationId, userMsg("m1"));
      await store.conversation.createItems(conversationId, userMsg("m2"));
      await store.conversation.createItems(conversationId, userMsg("m3"));
      await store.conversation.createItems(conversationId, summary("S1"));
      await store.conversation.createItems(conversationId, userMsg("mN"));
      await store.conversation.createItems(conversationId, summary("S2"));
      await store.conversation.createItems(conversationId, userMsg("mNx"));

      // → [summary1, summary2, mNx]: summaries stand in for the evicted messages.
      expect(await store.conversation.queryHistory(conversationId).forModel().execute()).toEqual([
        { type: "summary", content: "S1" },
        { type: "summary", content: "S2" },
        { type: "user_message", content: "mNx" },
      ]);
    });

    it("forModel returns the tail when there is no summary row", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("hi"));

      expect(await store.conversation.queryHistory(conversationId).forModel().execute()).toEqual([
        { type: "user_message", content: "hi" },
      ]);
    });

    it("readLatestSummaryText returns the latest summary", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: "first" },
      });
      await store.conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: "second" },
      });

      expect(await store.conversation.readLatestSummaryText(conversationId)).toBe("second");
    });

    it("accumulates token usage via usage_record rows", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, userMsg("hi"));
      await store.conversation.createItems(conversationId, assistantMsg("hello"));
      await store.conversation.recordUsage(conversationId, {
        kind: "parent",
        model: "gpt-test",
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 50,
      });

      const totals = await store.conversation.usageTotals(conversationId);
      expect(totals.actualInput).toBe(100);
      expect(totals.cachedInput).toBe(10);
      expect(totals.output).toBe(50);
      expect(totals.turns).toBe(1);
    });

    it("includes summarizer tokens in usage totals", async () => {
      const store = await createStore();
      const { conversationId } = store;
      await store.conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: "rolled up" },
      });
      await store.conversation.recordUsage(conversationId, {
        kind: "summarizer",
        model: "gpt-test",
        inputTokens: 30,
        cachedInputTokens: 0,
        outputTokens: 12,
      });

      const totals = await store.conversation.usageTotals(conversationId);
      expect(totals.summarizer).toBe(42);
    });

    it("deduplicates sources", async () => {
      const store = await createStore();
      const { profileId } = store;
      expect(await addSources(store, profileId, ["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"]);
      expect(await addSources(store, profileId, ["b.ts", "c.ts"])).toEqual(["c.ts"]);
      expect(await store.sources.query().forProfile(profileId).execute()).toEqual([
        expect.objectContaining({ path: "a.ts" }),
        expect.objectContaining({ path: "b.ts" }),
        expect.objectContaining({ path: "c.ts" }),
      ]);
    });

    it("stores facts in order", async () => {
      const store = await createStore();
      const { profileId } = store;
      await store.memory.create(profileId, "likes tea");
      await store.memory.create(profileId, "uses vim");

      expect(await store.memory.query().forProfile(profileId).execute()).toEqual([
        expect.objectContaining({ text: "likes tea" }),
        expect.objectContaining({ text: "uses vim" }),
      ]);
    });

    it("lists the active conversation", async () => {
      const store = await createStore();
      const conversations = await store.conversation.query().forProfile(store.profileId).execute();
      expect(
        conversations.some((entry: ConversationMeta) => entry.id === store.conversationId),
      ).toBe(true);
    });
  });
}

storeContract("sqlite :memory:", async () => LocalStore.open(":memory:"));

storeContract("sqlite file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-cli-contract-"));
  return LocalStore.open(join(dir, "chat.db"));
});
