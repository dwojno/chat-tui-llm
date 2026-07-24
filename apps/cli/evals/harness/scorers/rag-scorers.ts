import { createScorer } from "evalite";
import { AnswerRelevancy, ContextPrecision, ContextRelevancy, Faithfulness } from "autoevals";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "../client";
import type { RagResult } from "../rag";

const JUDGE_MODEL = process.env.RAG_JUDGE_MODEL ?? "gpt-4.1-mini";

export interface RagInput {
  query: string;
  category?: string;
  difficulty?: string;
}

export interface RagExpected {
  groundTruth?: string;
  expectInsufficient?: boolean;
  expectRefusal?: boolean;
  goldContextIds?: string[];
}

type RagScorer = ReturnType<typeof createScorer<RagInput, RagResult, RagExpected>>;

const notApplicable = { score: 1, metadata: { note: "n/a" } };

const toScore = (result: { score: number | null; metadata?: unknown }) => ({
  score: result.score ?? 0,
  metadata: result.metadata,
});

const auth = () => ({ client: openai(), model: JUDGE_MODEL });

const faithfulness: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Faithfulness",
  description: "answer claims are supported by the retrieved context (no hallucination)",
  scorer: async ({ input, output }) => {
    if (!output.retrievedContext.length) return notApplicable;
    return toScore(
      await Faithfulness({
        ...auth(),
        input: input.query,
        output: output.answer,
        context: output.retrievedContext,
      }),
    );
  },
});

const answerRelevancy: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
  name: "Answer Relevancy",
  description: "the answer is relevant and complete for the question",
  scorer: async ({ input, output, expected }) => {
    if (expected?.expectInsufficient || expected?.expectRefusal) return notApplicable;
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

const contextRelevancy: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const contextPrecision: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const admitsInsufficient: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const coverage = (wanted: string[], have: Set<string>): number =>
  wanted.length ? wanted.filter((id) => have.has(id)).length / wanted.length : 1;

const precision = (wanted: string[], have: string[]): number => {
  if (!have.length) return 1;
  const gold = new Set(wanted);
  return have.filter((id) => gold.has(id)).length / have.length;
};

const contextRecall: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const retrievalPrecision: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const retrievalF1: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const citationRecall: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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

const citationGrounding: RagScorer = createScorer<RagInput, RagResult, RagExpected>({
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
