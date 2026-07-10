import { z } from "zod";

export const ForkResultSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ key: z.string(), value: z.string() })),
  sources: z.array(z.string()).nullable(),
  confidence: z.enum(["high", "low"]),
  needsFollowup: z.string().nullable(),
});

export type ForkResult = z.infer<typeof ForkResultSchema>;
