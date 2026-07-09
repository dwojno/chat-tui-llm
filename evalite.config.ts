import { defineConfig } from "evalite/config";

export default defineConfig({
  // `dotenv/config` loads env first; `infra-setup` then auto-starts the RAG
  // services (Qdrant + MinIO) for the RAG eval. `infra-setup` never throws, so
  // the prompt-only suites still run if docker is unavailable.
  setupFiles: ["dotenv/config", "evals/harness/infra-setup.ts"],
  scoreThreshold: 0.9,
  testTimeout: 300_000,
});
