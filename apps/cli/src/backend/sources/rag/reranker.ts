import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { GEN_AI, setSpanIO, withLlmSpan } from "@chat/platform/telemetry";

export interface RerankCandidate {
  index: number;
  text: string;
}

export interface RankedHit {
  index: number;
  relevance: number;
}

export interface Reranker {
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

export class LlmReranker implements Reranker {
  constructor(
    private readonly openai: OpenAI,
    private readonly model: string,
  ) {}

  async rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RankedHit[]> {
    if (candidates.length <= topK) return identity(candidates, topK);

    return withLlmSpan(
      `gen_ai.rerank ${this.model}`,
      {
        model: this.model,
        operation: "rerank",
        attributes: { "rerank.candidates": candidates.length, "rerank.top_k": topK },
      },
      async (span) => {
        try {
          const list = candidates
            .map((candidate) => `[${candidate.index}] ${candidate.text}`)
            .join("\n\n");
          setSpanIO(span, { input: `Query: ${query}\n\nCandidates:\n${list}` });
          const response = await this.openai.responses.parse({
            model: this.model,
            instructions: INSTRUCTIONS,
            input: `Query: ${query}\n\nReturn at most ${topK} passages.\n\nCandidates:\n${list}`,
            text: { format: zodTextFormat(RerankResult, "rerank") },
            temperature: 0,
            store: false,
          });
          span.setAttribute(GEN_AI.inputTokens, response.usage?.input_tokens ?? 0);
          span.setAttribute(GEN_AI.outputTokens, response.usage?.output_tokens ?? 0);
          const parsed = response.output_parsed;
          if (!parsed) {
            span.addEvent("rerank.fallback", { reason: "no parsed output" });
            return identity(candidates, topK);
          }

          const valid = new Set(candidates.map((candidate) => candidate.index));
          const seen = new Set<number>();
          const ranked = parsed.ranking
            .filter((hit) => valid.has(hit.index) && !seen.has(hit.index) && seen.add(hit.index))
            .slice(0, topK)
            .map((hit) => ({ index: hit.index, relevance: clamp01(hit.relevance) }));
          span.setAttribute("rerank.kept", ranked.length);
          setSpanIO(span, { output: JSON.stringify(ranked) });
          return ranked.length ? ranked : identity(candidates, topK);
        } catch (error) {
          span.addEvent("rerank.fallback", {
            reason: error instanceof Error ? error.message : String(error),
          });
          return identity(candidates, topK);
        }
      },
    );
  }
}

function identity(candidates: RerankCandidate[], topK: number): RankedHit[] {
  return candidates.slice(0, topK).map((candidate) => ({ index: candidate.index, relevance: 1 }));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
