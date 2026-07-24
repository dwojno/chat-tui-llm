import assert from "node:assert/strict";
import { afterAll, describe, expect, it } from "vitest";
import { mcpCommand } from "@/app/commands/mcp";
import type { Session } from "@/app/session/session";
import { connectMcpServers, type McpConnection } from "@chat/tools/mcp";
import type { Store } from "@/store";
import type { ChatHandle } from "@/ui/chat";
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

describe("MCP + Playwright (real server)", () => {
  let connection: McpConnection | undefined;

  afterAll(async () => {
    await connection?.close();
  });

  it("manages Playwright via the /mcp modal and runs a tool against a real browser", async () => {
    const store = await createMemoryStore();

    // Add through the modal: pick "Add", then label + command prompts.
    await manage(
      store,
      scriptedChat({ picks: ["create"], prompts: ["playwright", "npx -y @playwright/mcp@latest"] }),
    );
    expect((await store.mcp.list(store.profileId))[0]).toMatchObject({
      label: "playwright",
      transport: "stdio",
    });

    // Disable, then re-enable, via the per-server action menu.
    await manage(store, scriptedChat({ picks: ["playwright", "toggle"] }));
    expect((await store.mcp.list(store.profileId))[0]?.enabled).toBe(false);
    await manage(store, scriptedChat({ picks: ["playwright", "toggle"] }));
    expect((await store.mcp.list(store.profileId))[0]?.enabled).toBe(true);

    // Restart-to-apply: a fresh connect (what the next boot does) exposes the tools.
    connection = await connectMcpServers(await store.mcp.list(store.profileId));
    const navigate = connection.tools.find((tool) => tool.name === "playwright__browser_navigate");
    assert(navigate);

    const result = await navigate.execute({
      url: "data:text/html,<title>MCP</title><h1>Hello from Playwright MCP</h1>",
    });
    expect(result).not.toContain("MCP error");
    expect(result.length).toBeGreaterThan(0);
  });
});
