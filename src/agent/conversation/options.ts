import type { ZodSchema } from "zod";
import { MODEL } from "../config";

export type TurnOptions = {
  stream: boolean;
  model: string;
  max_output_tokens: number;
  structured_output: ZodSchema | undefined;
  json_mode: boolean;
};

export const DEFAULT_TURN_OPTIONS = {
  stream: true,
  model: MODEL,
  max_output_tokens: 1000,
  structured_output: undefined,
  json_mode: false,
} satisfies TurnOptions;
