import { Readable } from "node:stream";
import type { BlobStore } from "@/backend/sources/rag/blob-store";
import { loadConfig, type RagConfig } from "@/config";
import { encodeSparse, type DenseEmbedder } from "@/backend/sources/rag/embeddings";
import { RagEngine } from "@/backend/sources/rag/engine";
import type { SearchResult, VectorIndex, VectorPoint } from "@/backend/sources/rag/qdrant";
import type { RagDeps } from "@/backend/sources/rag/deps";
import type { RankedHit, RerankCandidate, Reranker } from "@/backend/sources/rag/reranker";

const EMBED_DIM = 64;

class IdentityReranker implements Reranker {
  async rerank(_query: string, candidates: RerankCandidate[], topK: number): Promise<RankedHit[]> {
    return candidates.slice(0, topK).map((candidate) => ({ index: candidate.index, relevance: 1 }));
  }
}

class DeterministicEmbedder implements DenseEmbedder {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = Array.from({ length: EMBED_DIM }, () => 0);
      for (const token of text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)) {
        let hash = 0;
        for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) | 0;
        const slot = Math.abs(hash) % EMBED_DIM;
        vector[slot] = (vector[slot] ?? 0) + 1;
      }
      return vector;
    });
  }
}

class FakeObjectStore implements BlobStore {
  readonly buckets = new Map<string, Map<string, string>>();

  private bucket(profileId: string): Map<string, string> {
    let bucket = this.buckets.get(profileId);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(profileId, bucket);
    }
    return bucket;
  }

  async init(profileId: string): Promise<void> {
    this.bucket(profileId);
  }

  async put(profileId: string, key: string, body: string): Promise<void> {
    this.bucket(profileId).set(key, body);
  }

  async getText(profileId: string, key: string): Promise<string> {
    const body = this.bucket(profileId).get(key);
    if (body === undefined) throw new Error(`Missing object: ${key}`);
    return body;
  }

  async getRange(profileId: string, key: string, start: number, end: number): Promise<string> {
    const body = await this.getText(profileId, key);
    return Buffer.from(body, "utf8")
      .subarray(start, end + 1)
      .toString("utf8");
  }

  async getStream(profileId: string, key: string): Promise<Readable> {
    return Readable.from([await this.getText(profileId, key)]);
  }

  async list(profileId: string): Promise<string[]> {
    return [...this.bucket(profileId).keys()];
  }

  async remove(profileId: string, key: string): Promise<void> {
    this.bucket(profileId).delete(key);
  }
}

class FakeVectorIndex implements VectorIndex {
  readonly collections = new Map<string, VectorPoint[]>();

  private points(profileId: string): VectorPoint[] {
    let points = this.collections.get(profileId);
    if (!points) {
      points = [];
      this.collections.set(profileId, points);
    }
    return points;
  }

  async ensureCollection(profileId: string): Promise<void> {
    this.points(profileId);
  }

  async upsert(profileId: string, points: VectorPoint[]): Promise<void> {
    this.points(profileId).push(...points);
  }

  async search(
    profileId: string,
    denseQuery: number[],
    queryText: string,
    limit: number,
  ): Promise<SearchResult[]> {
    const points = this.points(profileId);
    if (!points.length) return [];
    const sparseQuery = encodeSparse(queryText);

    const denseRank = rankBy(points, (point) => cosine(denseQuery, point.dense));
    const sparseRank = rankBy(points, (point) => sparseDot(sparseQuery, encodeSparse(point.text)));

    const fused = points.map((point, i) => ({
      point,
      score: rrf(denseRank[i] ?? points.length) + rrf(sparseRank[i] ?? points.length),
    }));
    fused.sort((a, b) => b.score - a.score);
    return fused.slice(0, limit).map(({ point, score }) => ({ payload: point.payload, score }));
  }

  async deleteByPath(profileId: string, path: string): Promise<void> {
    this.collections.set(
      profileId,
      this.points(profileId).filter((point) => point.payload.path !== path),
    );
  }

  async dropCollection(profileId: string): Promise<void> {
    this.collections.delete(profileId);
  }
}

export interface FakeRag {
  deps: RagDeps;
  blob: FakeObjectStore;
  index: FakeVectorIndex;
}

export function createFakeRag(overrides: Partial<RagConfig> = {}): FakeRag {
  const { rag } = loadConfig({ OPENAI_API_KEY: "sk-test" });
  const config: RagConfig = { ...rag, ...overrides };
  const blob = new FakeObjectStore();
  const index = new FakeVectorIndex();
  const engine = new RagEngine(
    config,
    new DeterministicEmbedder(),
    blob,
    index,
    new IdentityReranker(),
  );
  return { deps: { engine }, blob, index };
}

function rankBy(points: VectorPoint[], score: (point: VectorPoint) => number): number[] {
  const scored = points.map((point, i) => ({ i, s: score(point) }));
  scored.sort((a, b) => b.s - a.s);
  const ranks = Array.from({ length: points.length }, () => 0);
  scored.forEach((entry, position) => {
    ranks[entry.i] = position + 1;
  });
  return ranks;
}

function rrf(rank: number): number {
  return 1 / (60 + rank);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function sparseDot(
  a: { indices: number[]; values: number[] },
  b: { indices: number[]; values: number[] },
): number {
  const map = new Map<number, number>();
  a.indices.forEach((index, i) => map.set(index, a.values[i] ?? 0));
  let dot = 0;
  b.indices.forEach((index, i) => {
    const value = map.get(index);
    if (value !== undefined) dot += value * (b.values[i] ?? 0);
  });
  return dot;
}
