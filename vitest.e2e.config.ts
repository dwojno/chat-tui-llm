import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tests": path.resolve(__dirname, "tests"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/e2e/full/**/*.e2e.ts", "tests/e2e/full/**/*.e2e-full.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
