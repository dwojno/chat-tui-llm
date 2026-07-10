import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE_ID } from "../../src/store/profile/profile.repository";
import { openMemoryStore } from "./helpers";

describe("Profile domain", () => {
  it("ensures the default profile exists on open", async () => {
    const store = await openMemoryStore();
    const row = await store.profile.query().byId(DEFAULT_PROFILE_ID).executeAndTakeFirst();
    expect(row).toMatchObject({ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_ID });
  });

  it("lists profiles ordered by createdAt", async () => {
    const store = await openMemoryStore();
    const first = await store.profile.create("Alpha");
    const second = await store.profile.create("Beta");

    const rows = await store.profile.query().execute();
    expect(rows.map((row) => row.id)).toEqual([DEFAULT_PROFILE_ID, first.id, second.id]);
  });

  it("filters profiles by id", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Work");

    expect(await store.profile.query().byId(created.id).executeAndTakeFirst()).toMatchObject({
      id: created.id,
      name: "Work",
    });
    expect(await store.profile.query().byId("missing").executeAndTakeFirst()).toBeNull();
  });

  it("deduplicates slug ids when names collide", async () => {
    const store = await openMemoryStore();
    const first = await store.profile.create("My Team");
    const second = await store.profile.create("My Team");

    expect(first.id).toBe("my-team");
    expect(second.id).toBe("my-team-1");
  });

  it("updates profile fields", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Config");

    await store.profile.update(created.id, {
      name: "Configured",
      model: "gpt-4o",
    });

    expect(await store.profile.query().byId(created.id).executeAndTakeFirst()).toMatchObject({
      name: "Configured",
      model: "gpt-4o",
    });
  });

  it("deletes a profile", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Disposable");

    await store.profile.delete(created.id);

    expect(await store.profile.query().byId(created.id).executeAndTakeFirst()).toBeNull();
  });

  it("switchTo binds context and creates a new conversation", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Other");
    const before = store.conversationId;

    await store.profile.switchTo(created.id);

    expect(store.profileId).toBe(created.id);
    expect(store.conversationId).not.toBe(before);
    const listed = await store.conversation.query().forProfile(created.id).execute();
    expect(listed.some((row) => row.id === store.conversationId)).toBe(true);
  });

  it("switchTo rejects unknown profile ids", async () => {
    const store = await openMemoryStore();
    await expect(store.profile.switchTo("no-such-profile")).rejects.toThrow(/Profile not found/);
  });

  it("slugifies punctuation-only names to profile", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("  @@@  ");
    expect(created.id).toBe("profile");
    expect(created.name).toBe("@@@");
  });

  it("ignores an empty update patch", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Stable");
    await store.profile.update(created.id, { model: "gpt-4o" });
    await store.profile.update(created.id, {});

    expect(await store.profile.query().byId(created.id).executeAndTakeFirst()).toMatchObject({
      name: "Stable",
      model: "gpt-4o",
    });
  });

  it("clears nullable fields when set to null", async () => {
    const store = await openMemoryStore();
    const created = await store.profile.create("Nullable");
    await store.profile.update(created.id, { model: "gpt-4o" });
    await store.profile.update(created.id, { model: null });

    expect(await store.profile.query().byId(created.id).executeAndTakeFirst()).toMatchObject({
      model: null,
    });
  });

  it("switchTo always starts a fresh conversation even for the active profile", async () => {
    const store = await openMemoryStore();
    const profileId = store.profileId;
    const before = store.conversationId;

    await store.profile.switchTo(profileId);

    expect(store.profileId).toBe(profileId);
    expect(store.conversationId).not.toBe(before);
  });
});
