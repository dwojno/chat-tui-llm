import { defineScorer, isAbsent, notApplicable } from "./common";

/** Is the answer within the word budget? */
export const withinWordLimit = defineScorer(
  "within-word-limit",
  "answer is at most the expected number of words",
  ({ output, expected }) => {
    const limit = expected?.maxWords;
    if (isAbsent(limit)) return notApplicable;
    const wordCount = output.text.split(/\s+/).filter(Boolean).length;
    return { score: wordCount <= limit ? 1 : 0, metadata: { wordCount, limit } };
  },
);
