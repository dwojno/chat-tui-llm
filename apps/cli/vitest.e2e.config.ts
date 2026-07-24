import path from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    root: __dirname,
    resolve: {
      alias: {
        "@tests": path.resolve(__dirname, "tests"),
        "@": path.resolve(__dirname, "src"),
      },
    },
    test: {
      name: "cli-e2e",
      include: ["tests/e2e/full/**/*.e2e.ts", "tests/e2e/full/**/*.e2e-full.ts"],
      setupFiles: ["tests/setup.ts"],
      testTimeout: 300_000,
      hookTimeout: 300_000,
      fileParallelism: false,
      retry: 2,
    },
  }),
);
