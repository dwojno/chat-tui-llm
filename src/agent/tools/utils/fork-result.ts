import { z } from "zod";

/**
 * Structured digest a fork hands back to its parent. Exact values (numbers,
 * paths, IDs) are preserved verbatim as strings in `findings` rather than being
 * flattened into prose — the whole point of the structured handoff. Every field
 * is present (OpenAI strict schema); optionals are modelled as `.nullable()`.
 */
export const ForkResultSchema = z.object({
  /** ≤80-word plain-language digest of conclusions and decisions. */
  summary: z.string(),
  /** Exact values pulled from the transcript, verbatim as strings. */
  findings: z.array(z.object({ key: z.string(), value: z.string() })),
  /** Citations / file paths the parent can reference, or null. */
  sources: z.array(z.string()).nullable(),
  confidence: z.enum(["high", "low"]),
  /** The single most important unresolved question, or null. */
  needsFollowup: z.string().nullable(),
});

export type ForkResult = z.infer<typeof ForkResultSchema>;
