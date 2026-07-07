import { z } from "zod";

/**
 * Structured-output schema for the `/structured` command: an answer plus the
 * sources that support it. Passed to the model as a response format and parsed
 * back out in {@link ../conversation/format}.
 */
export const ResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
});

/** Parsed shape of a {@link ResponseSchema} response. */
export type StructuredResponse = z.infer<typeof ResponseSchema>;
