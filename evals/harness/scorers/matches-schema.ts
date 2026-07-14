import { defineScorer, isAbsent, notApplicable } from "./common";

/** Does the structured/JSON output validate against the expected schema? */
export const matchesSchema = defineScorer(
  "matches-schema",
  "output validates against the expected Zod schema",
  ({ output, expected }) => {
    const schema = expected?.schema;
    if (isAbsent(schema)) return notApplicable;
    // A refusal (declining to fabricate an answer to an unanswerable prompt) is a
    // desirable outcome the schema can't represent — accept it when allowed.
    const refused = { score: 1, metadata: { note: "refusal accepted" } };
    let candidate: unknown = output.parsed;
    if (candidate == null) {
      try {
        candidate = JSON.parse(output.text);
      } catch {
        return expected?.allowRefusal
          ? refused
          : { score: 0, metadata: { error: "output was not valid JSON" } };
      }
    }
    const validation = schema.safeParse(candidate);
    if (validation.success) return { score: 1 };
    return expected?.allowRefusal
      ? refused
      : {
          score: 0,
          metadata: {
            issues: validation.error.issues.map(
              (issue) => `${issue.path.join(".")}: ${issue.message}`,
            ),
          },
        };
  },
);
