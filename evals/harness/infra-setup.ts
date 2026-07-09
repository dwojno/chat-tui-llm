import { ensureInfra } from "./infra";

/**
 * Evalite `setupFiles` entry: auto-start the RAG services before evals run.
 * Listed after `dotenv/config` so QDRANT_URL / MINIO_ENDPOINT are loaded first.
 * `ensureInfra` never throws, so this is safe for the prompt-only suites too.
 */
await ensureInfra();
