import { createScorer } from "evalite";
import { AnswerRelevancy, ContextPrecision, ContextRelevancy, Faithfulness } from "autoevals";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "./client";
import type { RagResult } from "./rag";

/**
 * Scorers for the RAG eval. The RAGAS-style metrics (Faithfulness, Context
 * Precision, Answer Relevancy, Context Relevancy) come from `autoevals` — its
 * canonical implementations — wrapped as evalite scorers that feed them the
 * *real* retrieved context from the task output. One hand-rolled judge covers
 * the "insufficient context" behaviour autoevals doesn't measure.
 *
 * The judge model is deliberately NOT the model under test, and `gpt-4.1-mini`
 * supports the `temperature: 0` + structured-output calls autoevals makes.
 */
const JUDGE_MODEL = process.env.RAG_JUDGE_MODEL ?? "gpt-4.1-mini";

/** The query sent through the pipeline (plus display-only case metadata). */
export interface RagInput {
  query: string;
  /** Edge-case category from the dataset — shown in the UI, not scored. */
  category?: string;
  /** "easy" | "medium" | "hard" — shown in the UI, not scored. */
  difficulty?: string;
}

/** Per-row expectation. All fields optional; a scorer no-ops (n/a) when absent. */
export interface RagExpected {
  /** Reference answer — enables Context Precision (needs a ground truth). */
  groundTruth?: string;
  /** This query is NOT answerable from the corpus; the answer must say so. */
  expectInsufficient?: boolean;
  /**
   * Basenames of the source files that SHOULD be retrieved/cited to answer
   * (only for genuine retrieval cases — omit for no-answer/decline cases, where
   * the listed docs are near-misses). Enables the retrieval + citation scorers.
   */
  goldContextIds?: string[];
}

type RagScorer = ReturnType<typeof createScorer<RagInput, RagResult, RagExpected>>;

const notApplicable = { score: 1, metadata: { note: "n/a" } };

/** autoevals scores may be null (reported as 0); normalise for evalite. */
const toScore = (result: { score: number | null; metadata?: unknown }) => ({
  score: result.score ?? 0,
  metadata: result.metadata,
});

const auth = () => ({ client: openai(), model: JUDGE_MODEL });

/** Are the generated answer's claims grounded in the retrieved context? */
export const faithfulness: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Faithfulness",
  description: "answer claims are supported by the retrieved context (no hallucination)",
  scorer: async ({ input, output }) =>
    toScore(
      await Faithfulness({
        ...auth(),
        input: input.query,
        output: output.answer,
        context: output.retrievedContext,
      }),
    ),
});

/** Does the answer actually address the question (no padding/evasion)? */
export const answerRelevancy: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Answer Relevancy",
  description: "the answer is relevant and complete for the question",
  scorer: async ({ input, output, expected }) => {
    // A correct refusal on an unanswerable query is intentionally "irrelevant".
    if (expected?.expectInsufficient) return notApplicable;
    return toScore(
      await AnswerRelevancy({
        ...auth(),
        input: input.query,
        output: output.answer,
        context: output.retrievedContext,
      }),
    );
  },
});

/** Is the retrieved context relevant to the question (retrieval quality)? */
export const contextRelevancy: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Context Relevancy",
  description: "the retrieved chunks are relevant to the question",
  scorer: async ({ input, output, expected }) => {
    if (!expected?.goldContextIds?.length) return notApplicable;
    if (!output.retrievedContext.length) return { score: 0, metadata: { note: "no context" } };
    return toScore(
      await ContextRelevancy({
        ...auth(),
        input: input.query,
        output: output.answer,
        context: output.retrievedContext,
      }),
    );
  },
});

/** Does the retrieved context contain what's needed for the reference answer? */
export const contextPrecision: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Context Precision",
  description: "retrieved context supports the ground-truth answer (needs groundTruth)",
  scorer: async ({ input, output, expected }) => {
    if (expected?.groundTruth === undefined) return notApplicable;
    return toScore(
      await ContextPrecision({
        ...auth(),
        input: input.query,
        output: output.answer,
        expected: expected.groundTruth,
        context: output.retrievedContext,
      }),
    );
  },
});

const InsufficientVerdict = z.object({
  admits_insufficient: z.boolean(),
  rationale: z.string(),
});

/**
 * For queries the corpus can't answer: the answer must clearly signal that the
 * retrieved context is insufficient, rather than fabricating one. Hand-rolled
 * because it's a behavioural check, not a RAGAS metric.
 */
export const admitsInsufficient: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Admits Insufficient",
  description: "on an unanswerable query, the answer says the context is insufficient",
  scorer: async ({ output, expected }) => {
    if (!expected?.expectInsufficient) return notApplicable;
    const response = await openai().responses.parse({
      model: JUDGE_MODEL,
      instructions:
        "You judge whether an answer admits it cannot be answered from the " +
        "provided context. Set `admits_insufficient` true only if the answer " +
        "clearly states the context lacks the information (a refusal or an " +
        '"I don\'t have enough information" style response). An answer that ' +
        "confidently states facts is NOT admitting insufficiency.",
      input: `Answer:\n"""\n${output.answer}\n"""`,
      text: { format: zodTextFormat(InsufficientVerdict, "verdict") },
      temperature: 0,
      max_output_tokens: 200,
      store: false,
    });
    const verdict = response.output_parsed;
    if (!verdict) return { score: 0, metadata: { error: "judge returned no verdict" } };
    return {
      score: verdict.admits_insufficient ? 1 : 0,
      metadata: { rationale: verdict.rationale },
    };
  },
});

/** overlap(a ⊇ wanted): fraction of `wanted` present in `have`. */
const coverage = (wanted: string[], have: Set<string>): number =>
  wanted.length ? wanted.filter((id) => have.has(id)).length / wanted.length : 1;

/**
 * precision(have ∩ wanted / have): the mirror of `coverage` — of the files the
 * agent actually retrieved, what fraction were gold? Divides by `have.length`
 * (what we retrieved), whereas `coverage` divides by `wanted.length` (gold).
 */
const precision = (wanted: string[], have: string[]): number => {
  if (!have.length) return 1;
  const gold = new Set(wanted);
  return have.filter((id) => gold.has(id)).length / have.length;
};

/**
 * Retrieval recall: of the gold source files, how many did the agent actually
 * pull context from? Measures the retriever independently of the wording of the
 * answer. n/a when a case has no gold ids (no-answer / out-of-domain / decline).
 */
export const contextRecall: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Context Recall",
  description: "gold source files that the agent actually retrieved (retriever quality)",
  scorer: ({ output, expected }) => {
    const gold = expected?.goldContextIds;
    if (!gold?.length) return notApplicable;
    const retrieved = new Set(output.retrievedSources);
    return {
      score: coverage(gold, retrieved),
      metadata: {
        gold,
        retrieved: [...retrieved],
        missing: gold.filter((id) => !retrieved.has(id)),
      },
    };
  },
});

/**
 * Retrieval precision: of the source files the agent pulled context from, how
 * many were actually gold? The counterpart to Context Recall — it PENALISES
 * over-retrieval (touching files beyond what the answer needs), which is exactly
 * the "receives all the things" problem. Coarse: scored at file-basename
 * granularity (there is no chunk-level gold), so it measures file *selectivity*,
 * not chunk-level correctness. n/a when a case has no gold ids.
 */
export const retrievalPrecision: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Retrieval Precision",
  description: "retrieved source files that were actually gold (penalises over-retrieval)",
  scorer: ({ output, expected }) => {
    const gold = expected?.goldContextIds;
    if (!gold?.length) return notApplicable;
    const retrieved = output.retrievedSources;
    if (!retrieved.length) return { score: 0, metadata: { note: "no retrieval" } };
    return {
      score: precision(gold, retrieved),
      metadata: {
        gold,
        retrieved,
        extraneous: retrieved.filter((id) => !gold.includes(id)),
      },
    };
  },
});

/**
 * Retrieval F1: harmonic mean of file-level precision and recall — one number
 * that drops if the agent either misses gold files (recall) OR fetches
 * extraneous ones (precision). Recomputed from the same primitives as the two
 * standalone scorers, since evalite runs each scorer in isolation. n/a without gold.
 */
export const retrievalF1: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Retrieval F1",
  description: "harmonic mean of retrieval precision and recall",
  scorer: ({ output, expected }) => {
    const gold = expected?.goldContextIds;
    if (!gold?.length) return notApplicable;
    const retrieved = output.retrievedSources;
    const r = coverage(gold, new Set(retrieved));
    const p = precision(gold, retrieved);
    const f1 = p + r ? (2 * p * r) / (p + r) : 0;
    return { score: f1, metadata: { precision: p, recall: r, retrieved } };
  },
});

/**
 * Citation correctness: of the gold source files, how many did the agent cite
 * in its `Sources:` line? This is the grounding the user sees. n/a without gold.
 */
export const citationRecall: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Citation Recall",
  description: "gold source files that the agent cited in its answer",
  scorer: ({ output, expected }) => {
    const gold = expected?.goldContextIds;
    if (!gold?.length) return notApplicable;
    const cited = new Set(output.citedSources);
    return {
      score: coverage(gold, cited),
      metadata: { gold, cited: [...cited], missing: gold.filter((id) => !cited.has(id)) },
    };
  },
});

/**
 * Citation grounding: every file the agent cites must be one it actually
 * retrieved — a cited file that was never retrieved is a fabricated citation.
 * Independent of gold, so it also guards the no-answer/decline cases. Score is
 * the fraction of citations that are backed by real retrieval; n/a when the
 * answer cites nothing.
 */
export const citationGrounding: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Citation Grounding",
  description: "every cited file was actually retrieved (no fabricated citations)",
  scorer: ({ output }) => {
    const cited = output.citedSources;
    if (!cited.length) return notApplicable;
    const retrieved = new Set(output.retrievedSources);
    const fabricated = cited.filter((id) => !retrieved.has(id));
    return {
      score: (cited.length - fabricated.length) / cited.length,
      metadata: { cited, retrieved: [...retrieved], fabricated },
    };
  },
});

export const ragScorers = [
  faithfulness,
  answerRelevancy,
  contextRelevancy,
  contextPrecision,
  admitsInsufficient,
  contextRecall,
  retrievalPrecision,
  retrievalF1,
  citationRecall,
  citationGrounding,
];
