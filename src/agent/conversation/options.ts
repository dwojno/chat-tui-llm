import type { ZodSchema } from "zod";

export type TurnOptions = {
  stream: boolean;
  temperature: number;
  max_output_tokens: number;
  structured_output: ZodSchema | undefined;
  json_mode: boolean;
};

export const DEFAULT_TURN_OPTIONS = {
  stream: true,
  temperature: 0.7,
  max_output_tokens: 1000,
  structured_output: undefined,
  json_mode: false,
} satisfies TurnOptions;
