import { defineConfig } from "evalite/config";

/**
 * Evalite config for the prompt evals (`pnpm eval` / `pnpm eval:watch`).
 * `setupFiles: dotenv/config` loads OPENAI_API_KEY from .env before any eval
 * runs. Timeout is generous because each case makes a live model call (and the
 * LLM-judge scorer makes another).
 */
export default defineConfig({
  setupFiles: ["dotenv/config"],
  testTimeout: 60_000,
});
