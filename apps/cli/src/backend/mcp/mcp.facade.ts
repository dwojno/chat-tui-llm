import type { McpFacade as McpFacadeContract, McpServer, McpServerInput } from "@chat/store";
import type { OneOrMany } from "../helpers";
import { McpRepository } from "./mcp.repository";

export class McpFacade implements McpFacadeContract {
  constructor(private readonly repo: McpRepository) {}

  async list(profileId: string): Promise<McpServer[]> {
    return this.repo.listByProfile(profileId);
  }

  async add(profileId: string, input: McpServerInput): Promise<McpServer> {
    return this.repo.insert(profileId, input);
  }

  async setEnabled(profileId: string, label: string, enabled: boolean): Promise<void> {
    this.repo.setEnabled(profileId, label, enabled);
  }

  async remove(profileId: string, label: OneOrMany<string>): Promise<void> {
    this.repo.deleteByLabel(profileId, label);
  }
}
