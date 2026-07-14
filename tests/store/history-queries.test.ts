import { describe, expect, it } from "vitest";
import type { Store } from "../../src/store";
import { openMemoryStore } from "./helpers";

/**
 * The three read modes of `queryHistory()` are the contract the whole agent loop
 * leans on, so they get their own coverage:
 *   - `.execute()`           → full transcript for UI replay (never summaries)
 *   - `.afterLastSummary()`  → the un-summarized tail the windower folds
 *   - `.forModel()`          → every summary segment + the messages after the last one
 */

const user = (content: string, turn = 0) => ({
  kind: "user_message" as const,
  turnIndex: turn,
  payload: { type: "user_message" as const, content },
});
const assistant = (content: string, turn = 0) => ({
  kind: "assistant_answer" as const,
  turnIndex: turn,
  payload: { type: "assistant_answer" as const, content },
});
const summary = (content: string) => ({
  kind: "summary" as const,
  turnIndex: null,
  payload: { type: "summary" as const, content },
});

async function seed(events: Array<Parameters<Store["conversation"]["createItems"]>[1]>) {
  const store = await openMemoryStore();
  for (const e of events) await store.conversation.createItems(store.conversationId, e);
  return store;
}

const c = (s: Store) => s.conversation.queryHistory(s.conversationId);

describe("queryHistory().execute() — UI transcript", () => {
  it("returns every message in id order and never a summary", async () => {
    const store = await seed([
      user("q1"),
      assistant("a1"),
      summary("S"),
      user("q2"),
      assistant("a2"),
    ]);
    expect(await c(store).execute()).toEqual([
      { type: "user_message", content: "q1" },
      { type: "assistant_answer", content: "a1" },
      { type: "user_message", content: "q2" },
      { type: "assistant_answer", content: "a2" },
    ]);
  });

  it("is empty for a conversation with no items", async () => {
    const store = await openMemoryStore();
    expect(await c(store).execute()).toEqual([]);
  });
});

describe("queryHistory().afterLastSummary() — the windower's tail", () => {
  it("returns only the non-summary messages after the last summary row", async () => {
    const store = await seed([user("old"), summary("S1"), user("mid"), summary("S2"), user("new")]);
    expect(await c(store).afterLastSummary().execute()).toEqual([
      { type: "user_message", content: "new" },
    ]);
  });

  it("returns the whole transcript when no summary exists yet", async () => {
    const store = await seed([user("a"), user("b")]);
    expect(await c(store).afterLastSummary().execute()).toEqual([
      { type: "user_message", content: "a" },
      { type: "user_message", content: "b" },
    ]);
  });
});

describe("queryHistory().forModel() — the model window", () => {
  it("returns all messages when nothing has been summarized", async () => {
    const store = await seed([user("q1"), assistant("a1"), user("q2")]);
    expect(await c(store).forModel().execute()).toEqual([
      { type: "user_message", content: "q1" },
      { type: "assistant_answer", content: "a1" },
      { type: "user_message", content: "q2" },
    ]);
  });

  it("keeps every summary segment and drops the messages they cover", async () => {
    // [m1, m2, m3, S1, mN, S2, mNx] → [S1, S2, mNx]
    const store = await seed([
      user("m1"),
      user("m2"),
      user("m3"),
      summary("S1"),
      user("mN"),
      summary("S2"),
      user("mNx"),
    ]);
    expect(await c(store).forModel().execute()).toEqual([
      { type: "summary", content: "S1" },
      { type: "summary", content: "S2" },
      { type: "user_message", content: "mNx" },
    ]);
  });

  it("returns just the summary when no messages have arrived since it", async () => {
    const store = await seed([user("m1"), summary("S1")]);
    expect(await c(store).forModel().execute()).toEqual([{ type: "summary", content: "S1" }]);
  });
});

describe("queryHistory() scoping", () => {
  it("never leaks items across conversations", async () => {
    const store = await seed([user("mine")]);
    const other = await store.conversation.create(store.profileId, "Other");
    await store.conversation.createItems(other.id, user("theirs"));

    expect(await c(store).execute()).toEqual([{ type: "user_message", content: "mine" }]);
    expect(await store.conversation.queryHistory(other.id).execute()).toEqual([
      { type: "user_message", content: "theirs" },
    ]);
  });
});
