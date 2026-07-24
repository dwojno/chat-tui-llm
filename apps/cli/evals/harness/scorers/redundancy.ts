import { createScorer } from "evalite";
import { canonicalizeArgs } from "@chat/engine";
import type { RagResult } from "../rag";
import type { RagExpected, RagInput } from "./rag-scorers";

export const noRedundantCalls = createScorer<RagInput, RagResult, RagExpected>({
  name: "No redundant calls",
  description: "no tool call (name + args) is issued more than once in the run",
  scorer: ({ output }) => {
    const counts = new Map<string, number>();
    for (const call of output.toolCalls) {
      const key = `${call.name}:${canonicalizeArgs(call.arguments)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const repeated = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key, n]) => `${key} ×${n}`);
    return repeated.length === 0 ? { score: 1 } : { score: 0, metadata: { repeated } };
  },
});
