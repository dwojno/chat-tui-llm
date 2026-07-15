import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { openai } from "../client";
import { defineScorer, isAbsent, notApplicable } from "./common";

const JUDGE_MODEL = "gpt-4.1-mini";

const JudgeSchema = z.object({
  score: z.number().min(1).max(5),
  passes: z.boolean(),
  rationale: z.string(),
  positive_criteria: z.array(z.string()),
  negative_criteria: z.array(z.string()),
});

export const judged = defineScorer(
  "llm-judge",
  "a model scores the answer against the rubric (1–5, scaled to 0–1)",
  async ({ output, expected }) => {
    const rubric = expected?.judge;
    if (isAbsent(rubric)) return notApplicable;
    const response = await openai().responses.parse({
      model: JUDGE_MODEL,
      instructions:
        "You are a strict evaluation judge. Score the candidate answer against " +
        "the rubric on a 1–5 scale (5 = fully satisfies). Set `passes` true only " +
        "if it clearly meets the rubric. Be concise in the rationale, and " +
        "mention both positives and negatives.",
      input: `Rubric:\n${rubric}\n\nCandidate answer:\n"""\n${output.text}\n"""`,
      text: { format: zodTextFormat(JudgeSchema, "judgement") },
      temperature: 0,
      max_output_tokens: 300,
      store: false,
    });
    const verdict = response.output_parsed;
    if (!verdict) return { score: 0, metadata: { error: "judge returned no verdict" } };
    return {
      score: verdict.score / 5,
      metadata: {
        score: verdict.score,
        passes: verdict.passes,
        rationale: verdict.rationale,
      },
    };
  },
);
