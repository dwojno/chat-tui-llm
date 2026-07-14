import { readFile } from "node:fs/promises";
import { evalite } from "evalite";
import { createRagHarness, type RagResult } from "../harness/rag";
import { ragScorers, type RagExpected, type RagInput } from "../harness/scorers/rag-scorers";

/**
 * End-to-end RAG eval — REAL, no mocks. On each run the harness prepares this
 * suite's isolated Qdrant collection + MinIO bucket, ingests the corpus in
 * `evals/harness/rag-corpus/` through the app's production `store.sources`
 * pipeline, then runs the real `Agent` loop per query and scores real
 * retrieval + real generation.
 *
 * Everything is programmatic: `harness.setup()` starts Qdrant + MinIO if
 * needed, resets the collection/bucket, and ingests — there are no CLIs. A real
 * `OPENAI_API_KEY` is required. Run just this suite with `pnpm eval:rag`.
 *
 * Cases come from `evals/harness/rag-dataset.json` (30 examples across 15
 * edge-case categories). The eval agent runs under a grounding directive that
 * forces it to answer only from the knowledge base and to end each answer with
 * a `Sources:` citation line, so we can score two grounding signals: what it
 * actually retrieved (`Context Recall`) and what it claims it used
 * (`Citation Recall` / `Citation Grounding`).
 */
const harness = createRagHarness({
  suiteId: "rag",
  corpusDir: "evals/harness/rag-corpus",
});

const DATASET_PATH = "evals/harness/rag-dataset.json";

interface DatasetExample {
  id: string;
  category: string;
  question: string;
  gold_context_ids: string[];
  ground_truth_answer: string;
  difficulty: "easy" | "medium" | "hard";
  notes: string;
}

/**
 * Cases whose `gold_context_ids` are near-misses a naive retriever might wrongly
 * surface, NOT docs that should be retrieved. The no-answer / out-of-domain
 * cases are already excluded via `expectInsufficient`; this covers the direct
 * prompt-injection case, whose correct behaviour is to decline, not retrieve.
 */
const NON_RETRIEVAL_IDS = new Set(["rag-024"]);

function usedRagResearchFork(output: RagResult): boolean {
  return output.toolCalls.some(
    (call) =>
      (call.name === "delegate_task" || call.name === "delegate_tasks") &&
      call.arguments.includes("rag_research"),
  );
}

function toCase(ex: DatasetExample): {
  input: RagInput;
  expected: RagExpected;
} {
  const insufficient = ex.ground_truth_answer === "NO_ANSWER";
  const isRetrievalCase =
    !insufficient && !NON_RETRIEVAL_IDS.has(ex.id) && ex.gold_context_ids.length > 0;
  return {
    input: {
      query: ex.question,
      category: ex.category,
      difficulty: ex.difficulty,
    },
    expected: {
      ...(insufficient ? { expectInsufficient: true } : { groundTruth: ex.ground_truth_answer }),
      ...(isRetrievalCase ? { goldContextIds: ex.gold_context_ids } : {}),
      ...(NON_RETRIEVAL_IDS.has(ex.id) ? { expectRefusal: true } : {}),
    },
  };
}

evalite<RagInput, RagResult, RagExpected>("rag pipeline", {
  data: async () => {
    try {
      await harness.setup();
    } catch (error) {
      throw new Error(
        "RAG eval setup failed. Ensure Docker is available (the harness auto-starts " +
          "Qdrant + MinIO) and OPENAI_API_KEY is set, then re-run.",
        { cause: error },
      );
    }
    const dataset: DatasetExample[] = JSON.parse(await readFile(DATASET_PATH, "utf8"));
    return dataset.map(toCase);
  },
  task: (input) => harness.myRagPipeline(input.query),
  scorers: ragScorers,
  // Surface the case metadata + the real retrieval/citation signals so a
  // reviewer can confirm grounding is genuine (retrieved vs cited vs gold).
  columns: ({ input, output, expected }) => [
    {
      label: "Category",
      value: `${input.category ?? "?"} (${input.difficulty ?? "?"})`,
    },
    { label: "Query", value: input.query },
    { label: "Answer", value: output.answer },
    { label: "Gold", value: expected?.goldContextIds?.join(", ") || "(n/a)" },
    {
      label: "Retrieved",
      value: output.retrievedSources.join(", ") || "(none)",
    },
    { label: "Cited", value: output.citedSources.join(", ") || "(none)" },
    { label: "rag_research fork", value: usedRagResearchFork(output) ? "yes" : "no" },
    { label: "Hits", value: String(output.retrievedHitCount) },
    {
      label: "Tool calls",
      value:
        output.toolCalls.map((call) => `${call.name}(${call.arguments})`).join("\n") || "(none)",
    },
    { label: "Retrieved context", value: output.retrievedContext },
  ],
});
