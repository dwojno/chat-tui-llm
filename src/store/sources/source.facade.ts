import { SourceRepository, type Source, type SourceQuery } from "./source.repository";
import type { OneOrMany } from "../helpers";

export abstract class SourcesFacade {
  abstract query(): SourceQuery;
  abstract create(profileId: string, path: string): Promise<Source>;
  abstract createMany(profileId: string, paths: string[]): Promise<Source[]>;
  abstract update(id: number, patch: { path: string }): Promise<void>;
  abstract delete(id: OneOrMany<number>): Promise<void>;
}

export class SqliteSourcesFacade extends SourcesFacade {
  constructor(private readonly repo: SourceRepository) {
    super();
  }

  query(): SourceQuery {
    return this.repo.query();
  }

  async create(profileId: string, path: string): Promise<Source> {
    return this.repo.insert(profileId, path);
  }

  async createMany(profileId: string, paths: string[]): Promise<Source[]> {
    if (!paths.length) return [];
    return this.repo.insertMany(profileId, paths);
  }

  async update(id: number, patch: { path: string }): Promise<void> {
    this.repo.update(id, patch.path);
  }

  async delete(id: OneOrMany<number>): Promise<void> {
    this.repo.delete(id);
  }
}
