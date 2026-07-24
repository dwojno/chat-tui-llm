import { defineConfig } from "evalite/config";

export default defineConfig({
  setupFiles: ["dotenv/config", "evals/harness/infra-setup.ts"],
  scoreThreshold: 0.9,
  testTimeout: 300_000,
});
