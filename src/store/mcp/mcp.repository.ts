import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import type { SqliteDb } from "@/store/db/db";
import { mcpServer } from "@/store/db/schema";
import { asArray, type OneOrMany } from "../helpers";

export type McpTransport = "stdio" | "http";

export type McpServer = {
  id: number;
  profileId: string;
  label: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  enabled: boolean;
  createdAt: number;
};

export type McpServerInput = {
  label: string;
  transport: McpTransport;
  url?: string | null;
  command?: string | null;
  args?: string[];
  enabled?: boolean;
};

type McpServerRow = typeof mcpServer.$inferSelect;

function toMcpServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    profileId: row.profileId,
    label: row.label,
    transport: row.transport as McpTransport,
    url: row.url,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : [],
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

export class McpRepository {
  constructor(private readonly db: SqliteDb) {}

  listByProfile(profileId: string): McpServer[] {
    return this.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.profileId, profileId))
      .orderBy(mcpServer.createdAt)
      .all()
      .map(toMcpServer);
  }

  insert(profileId: string, input: McpServerInput): McpServer {
    const row = this.db
      .insert(mcpServer)
      .values({
        profileId,
        label: input.label,
        transport: input.transport,
        url: input.url ?? null,
        command: input.command ?? null,
        args: JSON.stringify(input.args ?? []),
        enabled: input.enabled ?? true,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    assert(row !== undefined);
    return toMcpServer(row);
  }

  setEnabled(profileId: string, label: string, enabled: boolean): void {
    this.db
      .update(mcpServer)
      .set({ enabled })
      .where(and(eq(mcpServer.profileId, profileId), eq(mcpServer.label, label)))
      .run();
  }

  deleteByLabel(profileId: string, labels: OneOrMany<string>): void {
    const batch = asArray(labels);
    if (!batch.length) return;
    this.db
      .delete(mcpServer)
      .where(and(eq(mcpServer.profileId, profileId), inArray(mcpServer.label, batch)))
      .run();
  }
}
