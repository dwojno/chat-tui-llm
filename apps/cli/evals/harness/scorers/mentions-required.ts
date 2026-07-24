import { containsTerm, defineScorer, isAbsent, notApplicable } from "./common";

export const mentionsRequired = defineScorer(
  "mentions-required",
  "answer includes every required substring",
  ({ output, expected }) => {
    const required = expected?.mustContain;
    if (isAbsent(required) || required.length === 0) return notApplicable;
    const missing = required.filter((term) => !containsTerm(output.text, term));
    return {
      score: (required.length - missing.length) / required.length,
      metadata: missing.length ? { missing } : { present: required },
    };
  },
);
