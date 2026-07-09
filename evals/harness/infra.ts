import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Ensure the RAG services (Qdrant + MinIO) are up before the RAG eval runs.
 * Health-checks first (a no-op when they're already running), otherwise starts
 * them with `docker compose up -d` and waits for health. Never throws — if
 * docker is unavailable it warns and returns, so the prompt-only eval suites
 * still run; the RAG suite surfaces a clear error later if infra is truly down.
 *
 * Idempotent per process (memoized), so wiring it into evalite's `setupFiles`
 * (which run per worker) costs at most one health check.
 */
const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const STARTUP_TIMEOUT_MS = 60_000;

let ensured: Promise<void> | undefined;

export function ensureInfra(): Promise<void> {
  return (ensured ??= run());
}

async function run(): Promise<void> {
  if (await healthy()) return;

  console.log("[rag-eval] Qdrant/MinIO not reachable — starting via `docker compose up -d`…");
  try {
    await exec("docker", ["compose", "up", "-d"]);
  } catch (error) {
    console.warn(
      `[rag-eval] could not start infra automatically (${message(error)}). ` +
        "Start it manually with `pnpm infra:start`.",
    );
    return;
  }

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy()) {
      console.log("[rag-eval] infra ready.");
      return;
    }
    await delay(1000);
  }
  console.warn("[rag-eval] infra did not become healthy within 60s — continuing anyway.");
}

async function healthy(): Promise<boolean> {
  const [qdrant, minio] = await Promise.all([
    ping(`${QDRANT_URL}/collections`),
    ping(`${MINIO_ENDPOINT}/minio/health/live`),
  ]);
  return qdrant && minio;
}

async function ping(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
