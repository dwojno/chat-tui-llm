import { describe, expect, it } from "vitest";
import { LocalStore } from "@/backend";
import { openMemoryStore } from "./helpers";

describe("LocalStore edge cases", () => {
  it("rejects restoring a conversation that does not exist", async () => {
    await expect(LocalStore.open(":memory:", { conversationId: "missing" })).rejects.toThrow(
      /Conversation not found/,
    );
  });

  it("opens with a new conversation id on every in-memory open", async () => {
    const first = await openMemoryStore();
    const second = await openMemoryStore();

    expect(first.conversationId).not.toBe(second.conversationId);
  });

  it("isolates facts across separate in-memory stores", async () => {
    const first = await openMemoryStore();
    await first.memory.create(first.profileId, "only in first");

    const second = await openMemoryStore();
    expect(await second.memory.query().forProfile(second.profileId).execute()).toEqual([]);
  });
});
