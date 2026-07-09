import { describe, expect, it } from "vitest";
import { openMemoryStore } from "./helpers";

describe("Sources domain", () => {
  it("scopes sources to a profile", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");

    await store.sources.create(store.profileId, "src/a.ts");
    await store.sources.create(other.id, "src/b.ts");

    expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ profileId: store.profileId, path: "src/a.ts" }),
    ]);
    expect(await store.sources.query().forProfile(other.id).execute()).toEqual([
      expect.objectContaining({ profileId: other.id, path: "src/b.ts" }),
    ]);
  });

  it("returns sources in insertion order", async () => {
    const store = await openMemoryStore();
    await store.sources.create(store.profileId, "z.ts");
    await store.sources.create(store.profileId, "a.ts");
    await store.sources.create(store.profileId, "m.ts");

    const rows = await store.sources.query().forProfile(store.profileId).execute();
    expect(rows.map((row) => row.path)).toEqual(["z.ts", "a.ts", "m.ts"]);
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it("rejects duplicate paths for the same profile", async () => {
    const store = await openMemoryStore();
    await store.sources.create(store.profileId, "dup.ts");

    await expect(store.sources.create(store.profileId, "dup.ts")).rejects.toThrow();
  });

  it("allows the same path on different profiles", async () => {
    const store = await openMemoryStore();
    const other = await store.profile.create("Other");

    await store.sources.create(store.profileId, "shared.ts");
    await store.sources.create(other.id, "shared.ts");

    expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ path: "shared.ts", profileId: store.profileId }),
    ]);
    expect(await store.sources.query().forProfile(other.id).execute()).toEqual([
      expect.objectContaining({ path: "shared.ts", profileId: other.id }),
    ]);
  });

  it("returns the created source with id", async () => {
    const store = await openMemoryStore();
    const created = await store.sources.create(store.profileId, "src/main.ts");

    expect(created).toMatchObject({
      id: expect.any(Number),
      profileId: store.profileId,
      path: "src/main.ts",
      createdAt: expect.any(Number),
    });
  });

  it("updates and deletes sources", async () => {
    const store = await openMemoryStore();
    const first = await store.sources.create(store.profileId, "old.ts");
    const second = await store.sources.create(store.profileId, "keep.ts");

    await store.sources.delete(first.id);
    await store.sources.update(second.id, { path: "renamed.ts" });

    expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual([
      expect.objectContaining({ id: second.id, path: "renamed.ts" }),
    ]);
  });

  it("returns an empty list for a profile with no sources", async () => {
    const store = await openMemoryStore();
    expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual([]);
  });

  it("returns no rows for an unknown profile id", async () => {
    const store = await openMemoryStore();
    await store.sources.create(store.profileId, "local.ts");

    expect(await store.sources.query().forProfile("unknown-profile").execute()).toEqual([]);
  });

  it("rejects renaming a source to a path already used in the same profile", async () => {
    const store = await openMemoryStore();
    const first = await store.sources.create(store.profileId, "taken.ts");
    const second = await store.sources.create(store.profileId, "free.ts");

    await expect(store.sources.update(second.id, { path: "taken.ts" })).rejects.toThrow();
    expect(await store.sources.query().forProfile(store.profileId).execute()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, path: "taken.ts" }),
        expect.objectContaining({ id: second.id, path: "free.ts" }),
      ]),
    );
  });

  it("deleting a missing id is a no-op", async () => {
    const store = await openMemoryStore();
    await store.sources.create(store.profileId, "remains.ts");

    await expect(store.sources.delete(9_999)).resolves.toBeUndefined();
    expect(await store.sources.query().forProfile(store.profileId).execute()).toHaveLength(1);
  });
});
