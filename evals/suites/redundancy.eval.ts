import { evalite } from "evalite";
import { RAG_FORK_INSTRUCTIONS } from "@/app/tools/prompts/rag-fork";
import { createRagHarness, type RagResult } from "../harness/rag";
import { noRedundantCalls } from "../harness/scorers/redundancy";
import type { RagExpected, RagInput } from "../harness/scorers/rag-scorers";

const harness = createRagHarness({
  suiteId: "redundancy",
  corpusDir: "evals/harness/rag-corpus",
  instructions: RAG_FORK_INSTRUCTIONS,
});

evalite<RagInput, RagResult, RagExpected>("no redundant retrieval", {
  data: async () => {
    try {
      await harness.setup();
    } catch (error) {
      throw new Error(
        "Redundancy eval setup failed. Ensure Docker is available (the harness " +
          "auto-starts Qdrant + MinIO) and OPENAI_API_KEY is set, then re-run.",
        { cause: error },
      );
    }
    const empty: RagExpected = {};
    return [
      {
        input: { query: "Summarize how the deployment guide and the quotas doc fit together." },
        expected: empty,
      },
      {
        input: {
          query:
            "What does the security policy require, and where does it touch on billing and quotas?",
        },
        expected: empty,
      },
      {
        input: {
          query:
            "Walk through the architecture and note anything the changelog says changed about it.",
        },
        expected: empty,
      },
    ];
  },
  task: (input) => harness.myRagPipeline(input.query),
  scorers: [noRedundantCalls],
  columns: ({ input, output }) => [
    { label: "Query", value: input.query },
    {
      label: "Tool calls",
      value:
        output.toolCalls.map((call) => `${call.name}(${call.arguments})`).join("\n") || "(none)",
    },
  ],
});
