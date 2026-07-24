import { buildChatContext } from "@/session/switch";
import type { McpServer, McpServerInput, Store } from "@/backend";
import type { ChatHandle } from "@/ui/chat";
import type { PickerItem } from "@/ui/input/picker-keys";
import type { Command } from "./types";

const COMMAND = "/mcp";

const RESTART_HINT = "Restart to apply.";

function buildServerInput(label: string, target: string): McpServerInput | null {
  const trimmed = target.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//.test(trimmed)) return { label, transport: "http", url: trimmed };
  const [command, ...args] = trimmed.split(/\s+/);
  if (command === undefined) return null;
  return { label, transport: "stdio", command, args };
}

function describeTarget(server: McpServer): string {
  return server.transport === "http"
    ? (server.url ?? "")
    : [server.command, ...server.args].join(" ");
}

async function addServerFlow(store: Store, chat: ChatHandle): Promise<void> {
  const label = await chat.promptInModal({ title: "Server label", placeholder: "e.g. playwright" });
  if (!label?.trim()) return;
  const target = await chat.promptInModal({
    title: "Command or URL",
    placeholder: "npx -y @playwright/mcp@latest   ·   https://host/mcp",
  });
  if (target === null) return;
  const input = buildServerInput(label.trim(), target);
  if (!input) return;
  await store.mcp.add(store.profileId, input);
  chat.push({ role: "assistant", content: `Added MCP server "${input.label}". ${RESTART_HINT}` });
}

async function serverActionsFlow(store: Store, chat: ChatHandle, server: McpServer): Promise<void> {
  const action = await chat.pickEntity({
    title: `Manage "${server.label}"`,
    subtitle: `${server.transport} · ${describeTarget(server)}`,
    items: [
      { id: "toggle", label: server.enabled ? "Disable" : "Enable" },
      { id: "remove", label: "Remove" },
    ],
    createLabel: "Cancel",
  });
  if (action === null || action === "create") return;

  if (action === "toggle") {
    await store.mcp.setEnabled(store.profileId, server.label, !server.enabled);
    chat.push({
      role: "assistant",
      content: `${server.enabled ? "Disabled" : "Enabled"} MCP server "${server.label}". ${RESTART_HINT}`,
    });
  } else {
    await store.mcp.remove(store.profileId, server.label);
    chat.push({
      role: "assistant",
      content: `Removed MCP server "${server.label}". ${RESTART_HINT}`,
    });
  }
}

async function manageServers(store: Store, chat: ChatHandle): Promise<void> {
  const servers = await store.mcp.list(store.profileId);
  const items: PickerItem[] = servers.map((server) => ({
    id: server.label,
    label: server.label,
    meta: server.transport,
    status: server.enabled ? "on" : "off",
  }));
  const choice = await chat.pickEntity({
    title: "MCP servers",
    subtitle: "changes apply on restart",
    items,
    createLabel: "Add MCP server",
  });
  if (choice === null) return;

  if (choice === "create") {
    await addServerFlow(store, chat);
  } else {
    const server = servers.find((entry) => entry.label === choice);
    if (server) await serverActionsFlow(store, chat, server);
  }
  chat.setContext(await buildChatContext(store));
}

export const mcpCommand: Command = {
  name: "mcp",
  completion: COMMAND,
  hint: "manage MCP servers",
  matches: (input) => input.trim() === COMMAND,
  run: async (input, { store, chat }) => {
    chat.push({ role: "user", content: input.trim() });
    await manageServers(store, chat);
    return { kind: "handled" };
  },
};
