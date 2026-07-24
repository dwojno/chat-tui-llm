import type { Memory, MemoryFacade as MemoryFacadeContract, MemoryQuery } from "@chat/store";
import type { OneOrMany } from "../helpers";
import { MemoryRepository } from "./memory.repository";

export class MemoryFacade implements MemoryFacadeContract {
  constructor(private readonly repo: MemoryRepository) {}

  query(): MemoryQuery {
    return this.repo.query();
  }

  async create(profileId: string, text: string, category = "general"): Promise<Memory> {
    return this.repo.insert(profileId, text, category);
  }

  async update(id: number, patch: { text?: string; category?: string }): Promise<void> {
    this.repo.update(id, patch);
  }

  async delete(id: OneOrMany<number>): Promise<void> {
    this.repo.delete(id);
  }
}
