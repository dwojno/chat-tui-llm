import { defineConfig, mergeConfig } from "vitest/config";
import { sharedConfig } from "../../vitest.shared";

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      name: "tools",
      include: ["tests/**/*.test.ts"],
    },
  }),
);
