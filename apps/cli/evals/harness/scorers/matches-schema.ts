import { defineScorer, isAbsent, notApplicable } from "./common";

export const matchesSchema = defineScorer(
  "matches-schema",
  "output validates against the expected Zod schema",
  ({ output, expected }) => {
    const schema = expected?.schema;
    if (isAbsent(schema)) return notApplicable;

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
