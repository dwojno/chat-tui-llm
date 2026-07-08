import { defineScorer, isAbsent, notApplicable } from "./common";

/** Does the structured/JSON output validate against the expected schema? */
export const matchesSchema = defineScorer(
  "matches-schema",
  "output validates against the expected Zod schema",
  ({ output, expected }) => {
    const schema = expected?.schema;
    if (isAbsent(schema)) return notApplicable;
    let candidate: unknown = output.parsed;
    if (candidate == null) {
      try {
        candidate = JSON.parse(output.text);
      } catch {
        return { score: 0, metadata: { error: "output was not valid JSON" } };
      }
    }
    const validation = schema.safeParse(candidate);
    return validation.success
      ? { score: 1 }
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
