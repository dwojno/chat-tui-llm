import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tests": path.resolve(__dirname, "apps/cli/tests"),
      "@": path.resolve(__dirname, "apps/cli/src"),
    },
  },
  test: {
    include: ["apps/cli/tests/e2e/full/**/*.e2e.ts", "apps/cli/tests/e2e/full/**/*.e2e-full.ts"],
    environment: "node",
    setupFiles: ["apps/cli/tests/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    retry: 2,
  },
});
