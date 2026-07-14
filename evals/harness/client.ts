import { OpenAI } from "openai";

let client: OpenAI | undefined;

// Evals fan many suites/cases at the live model concurrently and routinely
// saturate the org's tokens-per-minute window. The SDK honours the `retry-after`
// on a 429, so a generous retry budget rides out transient TPM limits instead of
// failing the whole run.
export const EVAL_MAX_RETRIES = 8;

/**
 * One lazily-created OpenAI client shared by every task and scorer. Lazy so
 * importing an eval module never triggers the constructor (which throws without
 * a key) until a case actually runs.
 */
export function openai(): OpenAI {
  return (client ??= new OpenAI({ maxRetries: EVAL_MAX_RETRIES }));
}
