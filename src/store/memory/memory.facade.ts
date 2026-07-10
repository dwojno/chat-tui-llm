import type { OneOrMany } from "../helpers";
import { MemoryRepository, type Memory, type MemoryQuery } from "./memory.repository";

export abstract class MemoryFacade {
  abstract query(): MemoryQuery;
  abstract create(profileId: string, text: string, category?: string): Promise<Memory>;
  abstract update(id: number, patch: { text?: string; category?: string }): Promise<void>;
  abstract delete(id: OneOrMany<number>): Promise<void>;
}

export class SqliteMemoryFacade extends MemoryFacade {
  constructor(private readonly repo: MemoryRepository) {
    super();
  }

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
