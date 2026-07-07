import { defineScorer, isAbsent, notApplicable } from "./common";

/** Did the model pick the expected tool (or answer directly when 'direct')? */
export const routing = defineScorer(
  "routing",
  "calls the expected tool, or answers directly when route is 'direct'",
  ({ output, expected }) => {
    if (isAbsent(expected?.route)) return notApplicable;
    const calledTools = output.toolCalls.map((call) => call.name);
    if (expected.route === "direct") {
      return calledTools.length === 0
        ? { score: 1 }
        : { score: 0, metadata: { expected: "direct", calledTools } };
    }
    return calledTools.includes(expected.route)
      ? { score: 1, metadata: { calledTools } }
      : { score: 0, metadata: { expected: expected.route, calledTools } };
  },
);
