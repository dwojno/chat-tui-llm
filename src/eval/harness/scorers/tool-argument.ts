import { defineScorer, isAbsent, lowercase, notApplicable } from "./common";

/** Does a called tool carry the expected argument value? */
export const toolArgument = defineScorer(
  "tool-argument",
  "a called tool arg contains the expected substring",
  ({ output, expected }) => {
    const expectedArg = expected?.toolArg;
    if (isAbsent(expectedArg)) return notApplicable;
    const actualValues = output.toolCalls
      .map((call) => call.args[expectedArg.key])
      .filter((value): value is string => typeof value === "string");
    const match = actualValues.find((value) =>
      lowercase(value).includes(lowercase(expectedArg.contains)),
    );
    return match !== undefined
      ? { score: 1, metadata: { [expectedArg.key]: match } }
      : { score: 0, metadata: { wanted: expectedArg.contains, got: actualValues } };
  },
);
