import type { OpenAI } from "openai";
import { GEN_AI, setSpanIO, withLlmSpan } from "@/platform/telemetry";

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
    return withLlmSpan(
      `gen_ai.embeddings ${this.model}`,
      {
        model: this.model,
        operation: "embeddings",
        observationType: "embedding",
        attributes: { "gen_ai.request.input_count": texts.length },
      },
      async (span) => {
        const vectors: number[][] = [];
        let inputTokens = 0;
        for (let i = 0; i < texts.length; i += EMBED_BATCH) {
          const batch = texts.slice(i, i + EMBED_BATCH);
          const response = await this.openai.embeddings.create({ model: this.model, input: batch });
          inputTokens += response.usage?.prompt_tokens ?? 0;
          for (const item of response.data) vectors.push(item.embedding);
        }
        span.setAttribute(GEN_AI.inputTokens, inputTokens);
        setSpanIO(span, {
          input: JSON.stringify(texts),
          output: `${vectors.length} vectors × ${vectors[0]?.length ?? 0} dims`,
        });
        return vectors;
      },
    );
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

function hashToken(token: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 8) & 0xff_ff_ff;
}

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
