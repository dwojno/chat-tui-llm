import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

vi.mock("ink", () => ({
  render: () => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: () => Promise.resolve(),
  }),
  Box: (props: { children?: unknown }) => props.children,
  Text: (props: { children?: unknown }) => props.children,
  Static: () => null,
  useInput: () => {},
}));

import { DEFAULT_PROFILE_ID } from "@/store/profile/profile.repository";
import { LocalStore } from "@/store";
import { createE2EHarness, createTempDbDir, openFileStore, tempDbPath } from "./helpers";

let dir: string;

beforeEach(() => {
  dir = createTempDbDir();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("E2E: profiles", () => {
  it("creates a profile through the /profile picker and switches context", async () => {
    const h = await createE2EHarness();
    h.queuePicker("create");
    h.queuePrompt("Project Alpha");
    await h.run("/profile");

    expect(h.store.profileId).toBe("project-alpha");
    expect(h.lastAssistant()?.content).toContain('Switched to profile "Project Alpha"');
    expect(await h.store.profile.query().byId("project-alpha").executeAndTakeFirst()).toMatchObject(
      { name: "Project Alpha" },
    );
  });

  it("isolates facts per profile when switching", async () => {
    const h = await createE2EHarness();
    await h.run("/remember I like tea");

    const work = await h.store.profile.create("Work");
    h.queuePicker(work.id);
    await h.run("/profile");
    await h.run("/remember uses vim");

    expect(await h.session.memories()).toEqual(["uses vim"]);

    h.queuePicker(DEFAULT_PROFILE_ID);
    await h.run("/profile");
    expect(await h.session.memories()).toEqual(["I like tea"]);
  });

  it("re-selecting the active profile does not switch conversations", async () => {
    const h = await createE2EHarness();
    const conversationId = h.store.conversationId;
    const messageCount = h.chat.messages.length;

    h.queuePicker(h.store.profileId);
    await h.run("/profile");

    expect(h.store.conversationId).toBe(conversationId);
    expect(h.chat.messages).toHaveLength(messageCount + 1);
    expect(h.lastAssistant()).toBeUndefined();
  });

  it("cancelling the profile picker leaves context unchanged", async () => {
    const h = await createE2EHarness();
    const profileId = h.store.profileId;
    const conversationId = h.store.conversationId;

    h.queuePicker(null);
    await h.run("/profile");

    expect(h.store.profileId).toBe(profileId);
    expect(h.store.conversationId).toBe(conversationId);
  });

  it("persists profile-scoped facts across store reopen", async () => {
    const store = await openFileStore(dir);
    const h = await createE2EHarness({ store });
    await h.run("/remember survives reopen");

    const reopened = await LocalStore.open(tempDbPath(dir));
    const h2 = await createE2EHarness({ store: reopened });
    expect(await h2.session.memories()).toEqual(["survives reopen"]);
  });
});

describe("E2E: conversations", () => {
  it("keeps empty conversations until shutdown", async () => {
    const h = await createE2EHarness();
    const emptyConvId = h.store.conversationId;

    const kept = (await h.store.conversation.create(h.store.profileId, "Kept")).id;
    h.queuePicker(kept);
    await h.run("/conversation");

    expect(
      await h.store.conversation.query().byId(emptyConvId).executeAndTakeFirst(),
    ).not.toBeNull();
    expect(h.store.conversationId).toBe(kept);
  });

  it("starts a new conversation with an empty transcript", async () => {
    const h = await createE2EHarness({ turns: [{ text: "first" }, { text: "second" }] });
    const firstConvId = h.store.conversationId;
    await h.run("hello one");
    expect(h.chat.messages).toHaveLength(2);

    h.queuePicker("create");
    await h.run("/conversation");

    expect(h.chat.messages).toEqual([
      { role: "assistant", content: expect.stringContaining("Switched to conversation") },
    ]);
    expect(h.store.conversationId).not.toBe(firstConvId);

    await h.run("hello two");
    expect(h.chat.messages).toEqual([
      { role: "assistant", content: expect.stringContaining("Switched to conversation") },
      { role: "user", content: "hello two" },
      { role: "assistant", content: "second", steps: undefined },
    ]);
  });

  it("clears the chat view when switching conversations (no prior transcript shown)", async () => {
    const h = await createE2EHarness({ turns: [{ text: "in A" }, { text: "in B" }] });
    const convA = h.store.conversationId;
    await h.run("message A");

    const convB = (await h.store.conversation.create(h.store.profileId, "Second")).id;
    h.queuePicker(convB);
    await h.run("/conversation");
    await h.run("message B");

    h.queuePicker(convA);
    await h.run("/conversation");

    
    
    expect(h.chat.messages).toEqual([
      { role: "assistant", content: expect.stringContaining("Switched to conversation") },
    ]);
    expect(h.store.conversationId).toBe(convA);
  });

  it("keeps usage totals scoped to the active conversation", async () => {
    const h = await createE2EHarness({ turns: [{ text: "counted" }, { text: "other" }] });
    await h.run("turn in first");
    const convA = h.store.conversationId;
    const firstUsage = await h.session.getUsageTotals();
    expect(firstUsage.turns).toBe(1);

    const convB = (await h.store.conversation.create(h.store.profileId, "Other")).id;
    h.queuePicker(convB);
    await h.run("/conversation");
    expect(await h.session.getUsageTotals()).toMatchObject({ turns: 0 });

    await h.run("turn in second");
    expect((await h.session.getUsageTotals()).turns).toBe(1);

    h.queuePicker(convA);
    await h.run("/conversation");
    expect(await h.session.getUsageTotals()).toMatchObject({
      turns: 1,
      actualInput: firstUsage.actualInput,
      output: firstUsage.output,
    });
  });

  it("persists conversation history across store reopen", async () => {
    const store = await openFileStore(dir);
    const h = await createE2EHarness({ store, turns: [{ text: "persisted reply" }] });
    const { conversationId } = store;
    await h.run("save this");

    const restored = await LocalStore.open(tempDbPath(dir), { conversationId });
    const history = await restored.conversation.queryHistory(conversationId).execute();
    expect(history[0]).toMatchObject({ type: "user_message", content: "save this" });
    expect(history[1]).toMatchObject({ type: "assistant_answer" });
  });

  it("reopen without a conversation id starts a fresh conversation, keeping the profile", async () => {
    const store = await openFileStore(dir);
    const h = await createE2EHarness({ store, turns: [{ text: "hello" }] });
    const firstConversationId = store.conversationId;
    await h.run("first session");

    const reopened = await LocalStore.open(tempDbPath(dir));
    expect(reopened.profileId).toBe(store.profileId);
    
    expect(reopened.conversationId).not.toBe(firstConversationId);
    expect(await reopened.conversation.queryHistory(reopened.conversationId).execute()).toEqual([]);
  });
});
