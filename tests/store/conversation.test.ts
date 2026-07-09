import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./helpers";

describe("Conversation domain", () => {
  it("scopes conversations to a profile", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");
    const otherChat = await store.conversation.create(other.id, "Other chat");

    const defaultRows = await store.conversation.query().forProfile(store.profileId).execute();
    const otherRows = await store.conversation.query().forProfile(other.id).execute();

    expect(defaultRows.some((row) => row.id === store.conversationId)).toBe(true);
    expect(defaultRows.some((row) => row.id === otherChat.id)).toBe(false);
    expect(otherRows.map((row) => row.id)).toEqual([otherChat.id]);
  });

  it("filters conversations by id", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Test chat");

    expect(await store.conversation.query().byId(chat.id).executeAndTakeFirst()).toMatchObject({
      id: chat.id,
      title: "Test chat",
    });
    expect(await store.conversation.query().byId("missing").executeAndTakeFirst()).toBeNull();
  });

  it("orders conversations by createdAt descending by default", async () => {
    const store = await openMemoryStore();
    const first = await store.conversation.create(store.profileId, "First");
    const second = await store.conversation.create(store.profileId, "Second");

    const ordered = await store.conversation.query().forProfile(store.profileId).execute();

    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      assert(prev !== undefined && curr !== undefined);
      expect(prev.createdAt).toBeGreaterThanOrEqual(curr.createdAt);
    }
    expect(ordered.some((row) => row.id === first.id)).toBe(true);
    expect(ordered.some((row) => row.id === second.id)).toBe(true);
  });

  it("applies orderByLastActivity without changing the profile filter", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Active");
    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "ping" },
    });

    const ordered = await store.conversation
      .query()
      .forProfile(store.profileId)
      .orderByLastActivity()
      .execute();

    expect(ordered.some((row) => row.id === chat.id)).toBe(true);
    expect(ordered.every((row) => row.profileId === store.profileId)).toBe(true);
  });

  it("scopes item queries to a conversation", async () => {
    const store = await openMemoryStore();
    const first = await store.conversation.create(store.profileId, "First");
    const second = await store.conversation.create(store.profileId, "Second");

    await store.conversation.createItems(first.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "first" },
    });
    await store.conversation.createItems(second.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "second" },
    });

    const rows = await store.conversation.query().items().forConversation(first.id).execute();

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject({ content: "first" });
  });

  it("filters items by kind and orders by id descending", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Summaries");

    await store.conversation.createItems(chat.id, {
      kind: "summary",
      turnIndex: null,
      payload: { content: "first summary" },
    });
    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "hi" },
    });
    await store.conversation.createItems(chat.id, {
      kind: "summary",
      turnIndex: null,
      payload: { content: "second summary" },
    });

    const latestSummary = await store.conversation
      .query()
      .items()
      .forConversation(chat.id)
      .ofKind("summary")
      .orderByIdDesc()
      .executeAndTakeFirst();

    expect(JSON.parse(latestSummary?.payload ?? "{}")).toMatchObject({ content: "second summary" });
  });

  it("excludes summaries and rows before a boundary id", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Boundary");

    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "old" },
    });
    await store.conversation.createItems(chat.id, {
      kind: "summary",
      turnIndex: null,
      payload: { content: "rolled up" },
    });
    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 1,
      payload: { role: "user", content: "new" },
    });

    const boundary = await store.conversation
      .query()
      .items()
      .forConversation(chat.id)
      .ofKind("summary")
      .orderByIdDesc()
      .executeAndTakeFirst();
    assert(boundary !== null);
    const rows = await store.conversation
      .query()
      .items()
      .forConversation(chat.id)
      .withoutSummaries()
      .afterItemId(boundary.id)
      .execute();

    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.payload ?? "{}")).toMatchObject({ content: "new" });
  });

  it("updates and deletes conversations", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Rename me");

    await store.conversation.update(chat.id, { title: "Renamed" });
    expect(await store.conversation.query().byId(chat.id).executeAndTakeFirst()).toMatchObject({
      title: "Renamed",
    });

    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "hi" },
    });
    await store.conversation.delete(chat.id);
    expect(await store.conversation.query().byId(chat.id).executeAndTakeFirst()).toBeNull();
    expect(await store.conversation.query().items().forConversation(chat.id).execute()).toEqual([]);
  });

  it("filters conversations by assistant reply in SQL", async () => {
    const store = await openMemoryStore();
    const empty = await store.conversation.create(store.profileId, "Empty");
    const userOnly = await store.conversation.create(store.profileId, "User only");
    const replied = await store.conversation.create(store.profileId, "Replied");

    await store.conversation.createItems(userOnly.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "hi" },
    });
    await store.conversation.createItems(replied.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "assistant", content: "hello" },
    });

    expect(await store.conversation.query().byId(empty.id).withAssistantReply().execute()).toEqual(
      [],
    );
    expect(
      await store.conversation.query().byId(userOnly.id).withAssistantReply().execute(),
    ).toEqual([]);
    expect(
      await store.conversation.query().byId(replied.id).withAssistantReply().execute(),
    ).toEqual([expect.objectContaining({ id: replied.id })]);

    const withoutReply = await store.conversation
      .query()
      .forProfile(store.profileId)
      .withoutAssistantReply()
      .execute();
    const withoutReplyIds = new Set(withoutReply.map((row) => row.id));
    expect(withoutReplyIds.has(empty.id)).toBe(true);
    expect(withoutReplyIds.has(userOnly.id)).toBe(true);
    expect(withoutReplyIds.has(replied.id)).toBe(false);
    expect(withoutReplyIds.has(store.conversationId)).toBe(true);
  });

  it("prunes conversations without an assistant reply", async () => {
    const store = await openMemoryStore();
    const empty = await store.conversation.create(store.profileId, "Empty");
    const userOnly = await store.conversation.create(store.profileId, "User only");
    const kept = await store.conversation.create(store.profileId, "Kept");

    await store.conversation.createItems(userOnly.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "hi" },
    });
    await store.conversation.createItems(kept.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "assistant", content: "hello" },
    });

    await store.conversation.pruneEmpty();

    expect(await store.conversation.query().byId(empty.id).executeAndTakeFirst()).toBeNull();
    expect(await store.conversation.query().byId(userOnly.id).executeAndTakeFirst()).toBeNull();
    expect(await store.conversation.query().byId(kept.id).executeAndTakeFirst()).not.toBeNull();
  });

  it("deletes multiple conversations in one call", async () => {
    const store = await openMemoryStore();
    const first = await store.conversation.create(store.profileId, "First");
    const second = await store.conversation.create(store.profileId, "Second");
    const kept = await store.conversation.create(store.profileId, "Kept");

    await store.conversation.delete([first.id, second.id]);

    expect(await store.conversation.query().byId(first.id).executeAndTakeFirst()).toBeNull();
    expect(await store.conversation.query().byId(second.id).executeAndTakeFirst()).toBeNull();
    expect(await store.conversation.query().byId(kept.id).executeAndTakeFirst()).not.toBeNull();
  });

  it("switchTo binds an existing conversation in the active profile", async () => {
    const store = await openMemoryStore();
    const profileId = store.profileId;
    const initial = store.conversationId;
    const second = await store.conversation.create(profileId, "Second");

    await store.conversation.switchTo(second.id);

    expect(store.conversationId).toBe(second.id);
    expect(store.profileId).toBe(profileId);
    expect(initial).not.toBe(second.id);
  });

  it("switchTo rejects conversations outside the active profile", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");
    const foreign = await store.conversation.create(other.id, "Foreign");

    await expect(store.conversation.switchTo(foreign.id)).rejects.toThrow(/Conversation not found/);
  });

  it("returns an empty list for a profile with no conversations", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Empty");

    expect(await store.conversation.query().forProfile(other.id).execute()).toEqual([]);
  });

  it("returns an empty history for an unknown conversation id", async () => {
    const store = await openMemoryStore();
    expect(await store.conversation.queryHistory("missing-conversation").execute()).toEqual([]);
  });

  it("readLatestSummaryText returns empty when there is no summary", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "No summary");

    expect(await store.conversation.readLatestSummaryText(chat.id)).toBe("");
  });

  it("createItems with an empty batch is a no-op", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Batch");

    await store.conversation.createItems(chat.id, []);

    expect(await store.conversation.query().items().forConversation(chat.id).execute()).toEqual([]);
  });

  it("afterLastSummary returns the full tail when no summary exists", async () => {
    const store = await openMemoryStore();
    const chat = await store.conversation.create(store.profileId, "Tail");

    await store.conversation.createItems(chat.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "user", content: "only message" },
    });

    expect(await store.conversation.queryHistory(chat.id).afterLastSummary().execute()).toEqual([
      { role: "user", content: "only message" },
    ]);
  });

  it("switchTo rejects a conversation id that does not exist", async () => {
    const store = await openMemoryStore();
    await expect(store.conversation.switchTo("missing-conversation")).rejects.toThrow(
      /Conversation not found/,
    );
  });

  it("scopes byId and forProfile together", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");
    const foreign = await store.conversation.create(other.id, "Foreign");
    const local = await store.conversation.create(store.profileId, "Local");

    expect(
      await store.conversation.query().forProfile(store.profileId).byId(foreign.id).execute(),
    ).toEqual([]);
    expect(
      await store.conversation.query().forProfile(store.profileId).byId(local.id).execute(),
    ).toEqual([expect.objectContaining({ id: local.id, title: "Local" })]);
  });
});
