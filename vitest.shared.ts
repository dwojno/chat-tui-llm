import { defineConfig } from "vitest/config";

/** Shared defaults for every app/package vitest config. */
export const sharedConfig = defineConfig({
  test: {
    environment: "node",
  },
});
