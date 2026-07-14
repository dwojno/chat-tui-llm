import { z } from "zod";

export const ResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
});

export type StructuredResponse = z.infer<typeof ResponseSchema>;
