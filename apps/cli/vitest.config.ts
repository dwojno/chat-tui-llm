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
      name: "cli",
      include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
      setupFiles: ["tests/setup.ts"],
    },
  }),
);
