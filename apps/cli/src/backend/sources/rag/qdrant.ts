import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { createResiliencePolicy, type ResiliencePolicy } from "@chat/platform/utils/resilience";
import type { RagConfig } from "@/config";

export const DENSE_VECTOR_SIZE = 1536;

export interface ChunkPayload {
  path: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  headingPath: string;
  s3Key: string;
  text: string;
}

export interface VectorPoint {
  seed: string;
  dense: number[];
  text: string;
  payload: ChunkPayload;
}

export interface SearchResult {
  payload: ChunkPayload;
  score: number;
}

export interface VectorIndex {
  ensureCollection(profileId: string): Promise<void>;
  upsert(profileId: string, points: VectorPoint[]): Promise<void>;
  search(
    profileId: string,
    denseQuery: number[],
    queryText: string,
    limit: number,
  ): Promise<SearchResult[]>;
  deleteByPath(profileId: string, path: string): Promise<void>;
  dropCollection(profileId: string): Promise<void>;
}

const DENSE = "dense";
const SPARSE = "sparse";

export function pointId(seed: string): string {
  const hex = createHash("md5").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class QdrantIndex implements VectorIndex {
  private readonly client: QdrantClient;
  private readonly policy: ResiliencePolicy = createResiliencePolicy();
  private readonly ensured = new Set<string>();

  constructor(private readonly config: RagConfig) {
    this.client = new QdrantClient({ url: config.qdrantUrl });
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.policy.execute(fn);
  }

  private collectionFor(profileId: string): string {
    return `kb_${profileId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  }

  async ensureCollection(profileId: string): Promise<void> {
    const name = this.collectionFor(profileId);
    if (this.ensured.has(name)) return;
    const { exists } = await this.run(() => this.client.collectionExists(name));
    if (!exists) {
      await this.run(() =>
        this.client.createCollection(name, {
          vectors: { [DENSE]: { size: DENSE_VECTOR_SIZE, distance: "Cosine" } },
          sparse_vectors: { [SPARSE]: { modifier: "idf" } },
        }),
      );
      await this.run(() =>
        this.client.createPayloadIndex(name, { field_name: "path", field_schema: "keyword" }),
      );
    }
    this.ensured.add(name);
  }

  async upsert(profileId: string, points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    const name = this.collectionFor(profileId);
    await this.run(() =>
      this.client.upsert(name, {
        wait: true,
        points: points.map((point) => ({
          id: pointId(point.seed),
          vector: {
            [DENSE]: point.dense,
            [SPARSE]: { text: point.text, model: this.config.qdrantSparseModel },
          },
          payload: { ...point.payload },
        })),
      }),
    );
  }

  async search(
    profileId: string,
    denseQuery: number[],
    queryText: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const name = this.collectionFor(profileId);
    const response = await this.run(() =>
      this.client.query(name, {
        prefetch: [
          { query: denseQuery, using: DENSE, limit: limit * 2 },
          {
            query: { text: queryText, model: this.config.qdrantSparseModel },
            using: SPARSE,
            limit: limit * 2,
          },
        ],
        query: { fusion: "rrf" },
        limit,
        with_payload: true,
      }),
    );
    return response.points.map((point) => ({
      payload: point.payload as unknown as ChunkPayload,
      score: point.score,
    }));
  }

  async deleteByPath(profileId: string, path: string): Promise<void> {
    const name = this.collectionFor(profileId);
    await this.run(() =>
      this.client.delete(name, {
        wait: true,
        filter: { must: [{ key: "path", match: { value: path } }] },
      }),
    );
  }

  async dropCollection(profileId: string): Promise<void> {
    const name = this.collectionFor(profileId);
    this.ensured.delete(name);
    if ((await this.run(() => this.client.collectionExists(name))).exists) {
      await this.run(() => this.client.deleteCollection(name));
    }
  }
}
