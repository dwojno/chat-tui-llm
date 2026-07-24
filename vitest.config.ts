import { defineConfig } from "vitest/config";

/** Runs every app/package suite in one process (one watcher, one reporter). */
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
  },
});
