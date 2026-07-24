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
    include: [
      "apps/*/tests/**/*.test.ts",
      "apps/*/tests/**/*.test.tsx",
      "packages/*/tests/**/*.test.ts",
      "packages/*/tests/**/*.test.tsx",
    ],
    environment: "node",
    setupFiles: ["apps/cli/tests/setup.ts"],
  },
});
