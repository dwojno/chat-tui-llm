import { readFile } from "node:fs/promises";
import { evalite } from "evalite";
import { createRagHarness, type RagResult } from "../harness/rag";
import { ragScorers, type RagExpected, type RagInput } from "../harness/scorers/rag-scorers";

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
