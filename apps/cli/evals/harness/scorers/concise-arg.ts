import { defineScorer, isAbsent, notApplicable } from "./common";

export const conciseArg = defineScorer(
  "concise-arg",
  "a called tool arg is present and within its word budget",
  ({ output, expected }) => {
    const spec = expected?.conciseArg;
    if (isAbsent(spec)) return notApplicable;
    const values = output.toolCalls
      .map((call) => call.args[spec.key])
      .filter((value): value is string => typeof value === "string");
    if (values.length === 0) return { score: 0, metadata: { missing: spec.key } };
    const words = Math.max(
      ...values.map((value) => value.trim().split(/\s+/).filter(Boolean).length),
    );
    return words <= spec.maxWords
      ? { score: 1, metadata: { words } }
      : { score: 0, metadata: { words, limit: spec.maxWords } };
  },
);
