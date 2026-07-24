import { OpenAI } from "openai";

let client: OpenAI | undefined;

export const EVAL_MAX_RETRIES = 8;

export function openai(): OpenAI {
  return (client ??= new OpenAI({ maxRetries: EVAL_MAX_RETRIES }));
}
