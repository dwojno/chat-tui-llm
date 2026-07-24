import { defineScorer, isAbsent, notApplicable } from "./common";

export const avoidsTools = defineScorer(
  "avoids-tools",
  "none of the forbidden tools were called",
  ({ output, expected }) => {
    const forbidden = expected?.forbidTools;
    if (isAbsent(forbidden)) return notApplicable;
    const called = output.toolCalls.map((call) => call.name);
    const hits = forbidden.filter((tool) => called.includes(tool));
    return hits.length === 0 ? { score: 1 } : { score: 0, metadata: { forbidden: hits, called } };
  },
);
