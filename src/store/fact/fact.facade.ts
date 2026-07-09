import type { OneOrMany } from "../helpers";
import { FactRepository, type Fact, type FactQuery } from "./fact.repository";

export abstract class FactFacade {
  abstract query(): FactQuery;
  abstract create(profileId: string, text: string, category?: string): Promise<Fact>;
  abstract update(id: number, patch: { text?: string; category?: string }): Promise<void>;
  abstract delete(id: OneOrMany<number>): Promise<void>;
}

export class SqliteFactFacade extends FactFacade {
  constructor(private readonly repo: FactRepository) {
    super();
  }

  query(): FactQuery {
    return this.repo.query();
  }

  async create(profileId: string, text: string, category = "general"): Promise<Fact> {
    return this.repo.insert(profileId, text, category);
  }

  async update(id: number, patch: { text?: string; category?: string }): Promise<void> {
    this.repo.update(id, patch);
  }

  async delete(id: OneOrMany<number>): Promise<void> {
    this.repo.delete(id);
  }
}
