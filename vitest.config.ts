import { defineConfig } from "vitest/config";

/**
 * Unit-test config. Distinct from the prompt evals (`*.eval.ts`, run by evalite
 * against the live model) — these are fast, deterministic tests that mock the
 * model. Vitest's oxc transform handles the `.tsx` UI tests' JSX automatically.
 */
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
