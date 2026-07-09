import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

/**
 * Relevance reranking over hybrid-retrieval candidates (internal to the
 * `sources` domain). Hybrid RRF fusion is recall-oriented — it returns the top
 * `limit` fused hits regardless of how relevant each one actually is. A reranker
 * rescores a *larger* candidate pool against the query's true intent and keeps
 * only the best, which is what cuts the "receives all the things" over-retrieval.
 *
 * The abstraction lets the LLM implementation be swapped for a Cohere/cross-
 * encoder one later (a one-line change in `deps.ts`) — the engine only depends
 * on this interface.
 */

/** A candidate passage handed to the reranker; `index` maps back to the engine's own hit array. */
export interface RerankCandidate {
  index: number;
  /** Heading breadcrumb + chunk body — the same shape the embedder saw. */
  text: string;
}

/** A reranked hit: the original candidate index plus a 0..1 relevance score. */
export interface RankedHit {
  index: number;
  relevance: number;
}

export interface Reranker {
  /**
   * Return the most relevant candidates in descending relevance order, at most
   * `topK`. MUST NOT throw — implementations catch failures and degrade to the
   * input order so a search never fails because reranking did.
   */
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RankedHit[]>;
}

const RerankResult = z.object({
  ranking: z
    .array(
      z.object({
        index: z.number().int(),
        relevance: z.number(),
      }),
    )
    .describe("Most-relevant candidates first; omit off-topic ones."),
});

const INSTRUCTIONS =
  "You are a retrieval reranker. Given a user query and a numbered list of " +
  "candidate passages, decide which passages actually help answer the query. " +
  "Return them most-relevant first, at most the requested number, each with a " +
  "relevance score from 0 (irrelevant) to 1 (directly answers the query). OMIT " +
  "passages that are off-topic — do not pad the list. Use only the `index` " +
  "values shown; never invent one.";

/** Reranker backed by a single structured-output LLM call (reuses the app's OpenAI client). */
export class LlmReranker implements Reranker {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
  ) {}

  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RankedHit[]> {
    // Nothing to prune — skip the round-trip and keep the fused order.
    if (candidates.length <= topK) return identity(candidates, topK);

    try {
      const list = candidates
        .map((candidate) => `[${candidate.index}] ${candidate.text}`)
        .join("\n\n");
      const response = await this.openai.responses.parse({
        model: this.model,
        instructions: INSTRUCTIONS,
        input: `Query: ${query}\n\nReturn at most ${topK} passages.\n\nCandidates:\n${list}`,
        text: { format: zodTextFormat(RerankResult, "rerank") },
        temperature: 0,
        store: false,
      });
      const parsed = response.output_parsed;
      if (!parsed) return identity(candidates, topK);

      const valid = new Set(candidates.map((candidate) => candidate.index));
      const seen = new Set<number>();
      const ranked = parsed.ranking
        .filter((hit) => valid.has(hit.index) && !seen.has(hit.index) && seen.add(hit.index))
        .slice(0, topK)
        .map((hit) => ({ index: hit.index, relevance: clamp01(hit.relevance) }));
      // A well-formed-but-empty ranking means the model judged nothing relevant;
      // fall back to fused order rather than returning zero hits.
      return ranked.length ? ranked : identity(candidates, topK);
    } catch {
      return identity(candidates, topK);
    }
  }
}

/** Fused-order fallback: keep the top `topK` candidates, relevance unknown. */
function identity(candidates: RerankCandidate[], topK: number): RankedHit[] {
  return candidates.slice(0, topK).map((candidate) => ({ index: candidate.index, relevance: 1 }));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
