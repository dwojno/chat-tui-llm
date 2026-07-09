import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./helpers";

describe("Fact domain", () => {
  it("scopes facts to a profile", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");

    await store.fact.create(store.profileId, "default fact");
    await store.fact.create(other.id, "other fact");

    expect(await store.fact.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ profileId: store.profileId, text: "default fact" }),
    ]);
    expect(await store.fact.query().forProfile(other.id).execute()).toEqual([
      expect.objectContaining({ profileId: other.id, text: "other fact" }),
    ]);
  });

  it("filters facts by category", async () => {
    const store = await openMemoryStore();
    await store.fact.create(store.profileId, "general note");
    await store.fact.create(store.profileId, "prefers dark mode", "prefs");
    await store.fact.create(store.profileId, "likes tea", "prefs");

    expect(
      await store.fact.query().forProfile(store.profileId).inCategory("prefs").execute(),
    ).toEqual([
      expect.objectContaining({ text: "prefers dark mode", category: "prefs" }),
      expect.objectContaining({ text: "likes tea", category: "prefs" }),
    ]);
    expect(
      await store.fact.query().forProfile(store.profileId).inCategory("general").execute(),
    ).toEqual([expect.objectContaining({ text: "general note", category: "general" })]);
  });

  it("returns facts in insertion order", async () => {
    const store = await openMemoryStore();
    await store.fact.create(store.profileId, "first");
    await store.fact.create(store.profileId, "second");
    await store.fact.create(store.profileId, "third");

    const rows = await store.fact.query().forProfile(store.profileId).execute();
    expect(rows.map((row) => row.text)).toEqual(["first", "second", "third"]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("returns the created fact with id", async () => {
    const store = await openMemoryStore();
    const created = await store.fact.create(store.profileId, "remember this");

    expect(created).toMatchObject({
      id: expect.any(Number),
      profileId: store.profileId,
      text: "remember this",
      category: "general",
      createdAt: expect.any(Number),
    });
  });

  it("updates and deletes facts", async () => {
    const store = await openMemoryStore();
    const first = await store.fact.create(store.profileId, "old text", "general");
    const second = await store.fact.create(store.profileId, "keep me", "general");

    await store.fact.delete(first.id);
    await store.fact.update(second.id, { text: "updated", category: "prefs" });

    expect(await store.fact.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ id: second.id, text: "updated", category: "prefs" }),
    ]);
  });

  it("returns an empty list for a profile with no facts", async () => {
    const store = await openMemoryStore();
    expect(await store.fact.query().forProfile(store.profileId).execute()).toEqual([]);
  });

  it("returns no rows when filtering by an unused category", async () => {
    const store = await openMemoryStore();
    await store.fact.create(store.profileId, "only general");

    expect(
      await store.fact.query().forProfile(store.profileId).inCategory("prefs").execute(),
    ).toEqual([]);
  });

  it("executeAndTakeFirst returns null when nothing matches", async () => {
    const store = await openMemoryStore();
    expect(
      await store.fact
        .query()
        .forProfile(store.profileId)
        .inCategory("prefs")
        .executeAndTakeFirst(),
    ).toBeNull();
  });

  it("ignores an empty update patch", async () => {
    const store = await openMemoryStore();
    const created = await store.fact.create(store.profileId, "stable", "general");
    await store.fact.update(created.id, {});

    expect(await store.fact.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ id: created.id, text: "stable", category: "general" }),
    ]);
  });

  it("updates only the fields provided in the patch", async () => {
    const store = await openMemoryStore();
    const created = await store.fact.create(store.profileId, "original", "general");
    await store.fact.update(created.id, { text: "revised" });

    expect(await store.fact.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ id: created.id, text: "revised", category: "general" }),
    ]);
  });

  it("deleting a missing id is a no-op", async () => {
    const store = await openMemoryStore();
    await store.fact.create(store.profileId, "still here");

    await expect(store.fact.delete(9_999)).resolves.toBeUndefined();
    expect(await store.fact.query().forProfile(store.profileId).execute()).toHaveLength(1);
  });
});
