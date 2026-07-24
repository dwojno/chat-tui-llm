import { describe, expect, it } from "vitest";
import { mcpCommand } from "@/commands/mcp";
import type { Session } from "@/session/session";
import type { ChatHandle } from "@/ui/chat";
import type { Store } from "@/backend";
import { createMemoryStore } from "@tests/helpers/mock-openai";

function scriptedChat(script: {
  picks?: (string | "create" | null)[];
  prompts?: (string | null)[];
}): ChatHandle {
  const picks = [...(script.picks ?? [])];
  const prompts = [...(script.prompts ?? [])];
  return {
    push: () => {},
    setContext: () => {},
    pickEntity: async () => (picks.length ? picks.shift()! : null),
    promptInModal: async () => (prompts.length ? prompts.shift()! : null),
  } as unknown as ChatHandle;
}

async function manage(store: Store, chat: ChatHandle): Promise<void> {
  await mcpCommand.run("/mcp", { store, chat, session: undefined as unknown as Session });
}

describe("/mcp interactive manager", () => {
  it("adds an http server through the add flow", async () => {
    const store = await createMemoryStore();
    await manage(
      store,
      scriptedChat({ picks: ["create"], prompts: ["docs", "https://example.com/mcp"] }),
    );
    expect((await store.mcp.list(store.profileId))[0]).toMatchObject({
      label: "docs",
      transport: "http",
      url: "https://example.com/mcp",
    });
  });

  it("parses a stdio command from the single command/url prompt", async () => {
    const store = await createMemoryStore();
    await manage(
      store,
      scriptedChat({ picks: ["create"], prompts: ["pw", "npx -y @playwright/mcp@latest"] }),
    );
    expect((await store.mcp.list(store.profileId))[0]).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
    });
  });

  it("cancels the add flow when the label prompt is empty", async () => {
    const store = await createMemoryStore();
    await manage(store, scriptedChat({ picks: ["create"], prompts: [null] }));
    expect(await store.mcp.list(store.profileId)).toHaveLength(0);
  });

  it("toggles a selected server", async () => {
    const store = await createMemoryStore();
    await store.mcp.add(store.profileId, { label: "docs", transport: "http", url: "https://x" });
    await manage(store, scriptedChat({ picks: ["docs", "toggle"] }));
    expect((await store.mcp.list(store.profileId))[0]?.enabled).toBe(false);
  });

  it("removes a selected server", async () => {
    const store = await createMemoryStore();
    await store.mcp.add(store.profileId, { label: "docs", transport: "http", url: "https://x" });
    await manage(store, scriptedChat({ picks: ["docs", "remove"] }));
    expect(await store.mcp.list(store.profileId)).toHaveLength(0);
  });

  it("does nothing when the picker is dismissed", async () => {
    const store = await createMemoryStore();
    await store.mcp.add(store.profileId, { label: "docs", transport: "http", url: "https://x" });
    await manage(store, scriptedChat({ picks: [null] }));
    expect((await store.mcp.list(store.profileId))[0]?.enabled).toBe(true);
  });
});
