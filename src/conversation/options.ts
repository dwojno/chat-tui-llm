import type { ZodSchema } from "zod";

/**
 * Options controlling a single model turn: how it streams, how creative it is,
 * how long it can be, and which structured/JSON output mode (if any) to enforce.
 */
export type TurnOptions = {
  stream: boolean;
  temperature: number;
  max_output_tokens: number;
  structured_output: ZodSchema | undefined;
  json_mode: boolean;
};

/** Baseline turn: streaming plain-text answer at a moderate temperature. */
export const DEFAULT_TURN_OPTIONS = {
  stream: true,
  temperature: 0.7,
  max_output_tokens: 1000,
  structured_output: undefined,
  json_mode: false,
} satisfies TurnOptions;
