import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { ToolDefinition } from "@/agent/tools/types";
import type { McpServerConfig } from "./types";

export interface McpConnection {
  tools: ToolDefinition<z.ZodType>[];
  close: () => Promise<void>;
}

type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

type McpContentPart = { type: string; text?: string };

const passthrough = z.looseObject({});

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function flattenContent(content: McpContentPart[]): string {
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return text.length > 0 ? text : JSON.stringify(content);
}

export function mcpToolToDefinition(
  client: Pick<Client, "callTool">,
  serverLabel: string,
  tool: McpTool,
): ToolDefinition<typeof passthrough> {
  const name = `${sanitizeLabel(serverLabel)}__${tool.name}`;
  return {
    name,
    label: `${serverLabel}: ${tool.name}`,
    description: tool.description ?? tool.name,
    parameters: passthrough,
    rawParameters: tool.inputSchema,
    strict: false,
    requiresApproval: true,
    summarize: () => tool.name,
    async execute(args) {
      try {
        const result = await client.callTool({
          name: tool.name,
          arguments: args as Record<string, unknown>,
        });
        return flattenContent((result.content ?? []) as McpContentPart[]);
      } catch (error) {
        return `MCP error (${name}): ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

function buildTransport(server: McpServerConfig): Transport {
  if (server.transport === "http") {
    assert(server.url, `MCP server "${server.label}" has transport "http" but no url`);
    return new StreamableHTTPClientTransport(new URL(server.url)) as Transport;
  }
  assert(server.command, `MCP server "${server.label}" has transport "stdio" but no command`);
  return new StdioClientTransport({ command: server.command, args: server.args ?? [] });
}

type ConnectedServer = { client: Client; tools: ToolDefinition<z.ZodType>[] };

async function connectServer(server: McpServerConfig): Promise<ConnectedServer | null> {
  const startedAt = Date.now();
  try {
    const client = new Client({ name: "chat-cli", version: "1.0.0" });
    await client.connect(buildTransport(server));
    const { tools: mcpTools } = await client.listTools();
    const tools = (mcpTools as McpTool[]).map((tool) =>
      mcpToolToDefinition(client, server.label, tool),
    );
    console.error(`  mcp/${server.label}: ${tools.length} tool(s) in ${Date.now() - startedAt}ms`);
    return { client, tools };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`  mcp/${server.label}: failed to connect; skipping. ${detail}`);
    return null;
  }
}

export async function connectMcpServers(servers: McpServerConfig[]): Promise<McpConnection> {
  const enabled = servers.filter((server) => server.enabled);
  if (enabled.length === 0) return { tools: [], close: async () => {} };

  console.error(
    `Connecting ${enabled.length} MCP server(s): ${enabled.map((s) => s.label).join(", ")}…`,
  );
  const startedAt = Date.now();

  const connected = (await Promise.all(enabled.map(connectServer))).filter(
    (result): result is ConnectedServer => result !== null,
  );
  const tools = connected.flatMap((result) => result.tools);
  console.error(
    `MCP ready: ${tools.length} tool(s) from ${connected.length}/${enabled.length} server(s) in ${Date.now() - startedAt}ms`,
  );

  return {
    tools,
    close: async () => {
      await Promise.allSettled(connected.map((result) => result.client.close()));
    },
  };
}
