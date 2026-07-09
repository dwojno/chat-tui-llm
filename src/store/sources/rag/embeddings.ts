import type { OpenAI } from "openai";

/**
 * Embedding utilities (internal to the `sources` domain).
 *
 * Dense vectors come from OpenAI. Sparse vectors are produced by Qdrant
 * server-side inference in the primary path (see `qdrant.ts`); `encodeSparse`
 * is a self-contained BM25-lite encoder used as an offline fallback and by
 * tests, so the pipeline stays exercisable without a live inference server.
 */

export interface DenseEmbedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

const EMBED_BATCH = 64;

export class OpenAIDenseEmbedder implements DenseEmbedder {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const response = await this.openai.embeddings.create({ model: this.model, input: batch });
      for (const item of response.data) vectors.push(item.embedding);
    }
    return vectors;
  }
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "are",
  "was",
  "were",
  "be",
  "as",
  "at",
  "by",
  "it",
  "this",
  "that",
  "with",
  "from",
  "into",
  "than",
  "then",
  "so",
  "if",
  "we",
  "you",
  "they",
  "he",
  "she",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** FNV-1a hash into a 24-bit index space, keeping sparse vectors compact. */
function hashToken(token: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 8) & 0xff_ff_ff;
}

/** BM25-lite sparse vector: hashed token indices with log-scaled term frequency. */
export function encodeSparse(text: string): SparseVector {
  const counts = new Map<number, number>();
  for (const token of tokenize(text)) {
    const index = hashToken(token);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const indices: number[] = [];
  const values: number[] = [];
  for (const [index, tf] of counts) {
    indices.push(index);
    values.push(1 + Math.log(tf));
  }
  return { indices, values };
}
