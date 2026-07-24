import { describe, expect, it } from "vitest";
import { createMemoryStore } from "@tests/helpers/mock-openai";

describe("mcp facade", () => {
  it("adds, lists, toggles, and removes servers per profile", async () => {
    const store = await createMemoryStore();
    const profileId = store.profileId;

    await store.mcp.add(profileId, {
      label: "docs",
      transport: "http",
      url: "https://example.com/mcp",
    });
    await store.mcp.add(profileId, {
      label: "local",
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    });

    const listed = await store.mcp.list(profileId);
    expect(listed.map((s) => s.label)).toEqual(["docs", "local"]);
    expect(listed[0]).toMatchObject({
      transport: "http",
      url: "https://example.com/mcp",
      enabled: true,
    });
    expect(listed[1]).toMatchObject({ transport: "stdio", command: "node", args: ["server.js"] });

    await store.mcp.setEnabled(profileId, "docs", false);
    const afterToggle = await store.mcp.list(profileId);
    expect(afterToggle.find((s) => s.label === "docs")?.enabled).toBe(false);

    await store.mcp.remove(profileId, "local");
    const afterRemove = await store.mcp.list(profileId);
    expect(afterRemove.map((s) => s.label)).toEqual(["docs"]);
  });

  it("scopes servers to their profile", async () => {
    const store = await createMemoryStore();
    const other = await store.profile.create("work");

    await store.mcp.add(store.profileId, { label: "a", transport: "http", url: "https://a" });
    await store.mcp.add(other.id, { label: "b", transport: "http", url: "https://b" });

    expect((await store.mcp.list(store.profileId)).map((s) => s.label)).toEqual(["a"]);
    expect((await store.mcp.list(other.id)).map((s) => s.label)).toEqual(["b"]);
  });
});
