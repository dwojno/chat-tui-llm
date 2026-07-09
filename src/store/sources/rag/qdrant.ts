import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { DENSE_VECTOR_SIZE, type RagConfig } from "./config";

/**
 * Per-profile vector index on Qdrant (internal to the `sources` domain).
 *
 * Each profile gets a collection `kb_${profileId}` with a dense named vector
 * (OpenAI, cosine) and a sparse named vector produced by Qdrant server-side
 * inference (`QDRANT_SPARSE_MODEL`, e.g. bm25). Search fuses both with RRF via
 * the Query API. The `VectorIndex` interface lets tests swap an in-memory fake.
 */

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
  /** Stable seed (profileId + path + chunkIndex) → deterministic point id. */
  seed: string;
  dense: number[];
  /** Raw text for sparse inference and snippet display. */
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
  private readonly ensured = new Set<string>();

  constructor(private readonly config: RagConfig) {
    this.client = new QdrantClient({ url: config.qdrantUrl });
  }

  private collectionFor(profileId: string): string {
    return `kb_${profileId}`.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  }

  async ensureCollection(profileId: string): Promise<void> {
    const name = this.collectionFor(profileId);
    if (this.ensured.has(name)) return;
    const { exists } = await this.client.collectionExists(name);
    if (!exists) {
      await this.client.createCollection(name, {
        vectors: { [DENSE]: { size: DENSE_VECTOR_SIZE, distance: "Cosine" } },
        sparse_vectors: { [SPARSE]: { modifier: "idf" } },
      });
      await this.client.createPayloadIndex(name, { field_name: "path", field_schema: "keyword" });
    }
    this.ensured.add(name);
  }

  async upsert(profileId: string, points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    const name = this.collectionFor(profileId);
    await this.client.upsert(name, {
      wait: true,
      points: points.map((point) => ({
        id: pointId(point.seed),
        vector: {
          [DENSE]: point.dense,
          // Server-side inference: Qdrant embeds the document into a sparse vector.
          [SPARSE]: { text: point.text, model: this.config.qdrantSparseModel },
        },
        payload: { ...point.payload },
      })),
    });
  }

  async search(
    profileId: string,
    denseQuery: number[],
    queryText: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const name = this.collectionFor(profileId);
    const response = await this.client.query(name, {
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
    });
    return response.points.map((point) => ({
      payload: point.payload as unknown as ChunkPayload,
      score: point.score,
    }));
  }

  async deleteByPath(profileId: string, path: string): Promise<void> {
    const name = this.collectionFor(profileId);
    await this.client.delete(name, {
      wait: true,
      filter: { must: [{ key: "path", match: { value: path } }] },
    });
  }

  async dropCollection(profileId: string): Promise<void> {
    const name = this.collectionFor(profileId);
    this.ensured.delete(name);
    if ((await this.client.collectionExists(name)).exists) {
      await this.client.deleteCollection(name);
    }
  }
}
