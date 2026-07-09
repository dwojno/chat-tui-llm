import assert from "node:assert";
import { readFile as fsReadFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SourceRepository, type Source, type SourceQuery } from "./source.repository";
import type { OneOrMany } from "../helpers";
import type { RagDeps } from "./rag/deps";
import type { RagEngine } from "./rag/engine";
import type {
  GrepMatch,
  GrepOptions,
  IndexResult,
  ReadRange,
  SearchHit,
  SearchOptions,
  SourceProgress,
} from "./types";

const NOT_CONFIGURED =
  "Knowledge base is not configured. Start MinIO + Qdrant (docker compose up) " +
  "and set the MINIO_*/QDRANT_* env vars.";

const DEFAULT_SEARCH_LIMIT = 8;

export abstract class SourcesFacade {
  abstract query(): SourceQuery;
  abstract create(profileId: string, path: string): Promise<Source>;
  abstract createMany(profileId: string, paths: string[]): Promise<Source[]>;
  abstract update(id: number, patch: { path: string }): Promise<void>;
  abstract delete(id: OneOrMany<number>): Promise<void>;

  // RAG lifecycle — the domain's public API, consumed by the agent tools.
  // Streaming operations are async generators so the UI can show live progress.
  abstract add(profileId: string, path: string): AsyncGenerator<SourceProgress, IndexResult>;
  abstract reindex(profileId: string): AsyncGenerator<SourceProgress, IndexResult[]>;
  abstract remove(profileId: string, id: number): Promise<void>;
  abstract reset(profileId: string): Promise<void>;
  abstract search(profileId: string, query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  abstract listFiles(profileId: string): Promise<string[]>;
  abstract grep(
    profileId: string,
    pattern: string,
    opts?: GrepOptions,
  ): AsyncGenerator<GrepMatch, void>;
  abstract readFile(profileId: string, path: string, range: ReadRange): Promise<string>;
}

export class SqliteSourcesFacade extends SourcesFacade {
  constructor(
    private readonly repo: SourceRepository,
    private readonly deps?: RagDeps,
  ) {
    super();
  }

  private engine(): RagEngine {
    assert(this.deps, NOT_CONFIGURED);
    return this.deps.engine;
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

  async *add(profileId: string, path: string): AsyncGenerator<SourceProgress, IndexResult> {
    const engine = this.engine();
    const row = this.repo.getByPath(profileId, path) ?? this.repo.insert(profileId, path);
    try {
      const bytes = await fsReadFile(resolve(process.cwd(), path));
      const { s3Key, contentHash, chunkCount } = yield* engine.indexDocument(
        profileId,
        path,
        bytes,
      );
      this.repo.markIndexed(row.id, {
        status: "indexed",
        s3Key,
        contentHash,
        chunkCount,
        indexedAt: Date.now(),
      });
      return { path, chunkCount, status: "indexed" };
    } catch (error) {
      this.repo.markIndexed(row.id, { status: "error" });
      return { path, chunkCount: 0, status: "error", error: errorMessage(error) };
    }
  }

  async *reindex(profileId: string): AsyncGenerator<SourceProgress, IndexResult[]> {
    const rows = await this.repo.query().forProfile(profileId).execute();
    const results: IndexResult[] = [];
    for (const row of rows) {
      results.push(yield* this.add(profileId, row.path));
    }
    return results;
  }

  async remove(profileId: string, id: number): Promise<void> {
    const engine = this.engine();
    const rows = await this.repo.query().forProfile(profileId).execute();
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;
    await engine.removeDocument(profileId, row.path, row.s3Key ?? engine.s3KeyFor(row.path));
    this.repo.delete(id);
  }

  async reset(profileId: string): Promise<void> {
    await this.engine().reset(profileId);
    const rows = await this.repo.query().forProfile(profileId).execute();
    if (rows.length) this.repo.delete(rows.map((row) => row.id));
  }

  async search(profileId: string, query: string, opts?: SearchOptions): Promise<SearchHit[]> {
    return this.engine().search(profileId, query, opts?.limit ?? DEFAULT_SEARCH_LIMIT);
  }

  async listFiles(profileId: string): Promise<string[]> {
    const rows = await this.repo.query().forProfile(profileId).execute();
    return rows.filter((row) => row.status === "indexed").map((row) => row.path);
  }

  async *grep(
    profileId: string,
    pattern: string,
    opts?: GrepOptions,
  ): AsyncGenerator<GrepMatch, void> {
    const engine = this.engine();
    const rows = (await this.repo.query().forProfile(profileId).execute()).filter(
      (row) => row.status === "indexed",
    );
    const wanted = opts?.paths?.length ? new Set(opts.paths) : null;
    const files = rows
      .filter((row) => !wanted || wanted.has(row.path))
      .map((row) => ({ path: row.path, key: row.s3Key ?? engine.s3KeyFor(row.path) }));
    yield* engine.grep(profileId, files, pattern, opts ?? {});
  }

  async readFile(profileId: string, path: string, range: ReadRange): Promise<string> {
    const engine = this.engine();
    const row = this.repo.getByPath(profileId, path);
    assert(row, `Source not indexed: ${path}`);
    return engine.readFile(profileId, row.s3Key ?? engine.s3KeyFor(path), range);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
