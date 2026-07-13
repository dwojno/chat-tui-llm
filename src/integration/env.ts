import { z } from "zod";
import { loadRagConfig } from "../store";
import { loadTelemetryConfig } from "./telemetry/config";

/**
 * App-level process-env validation, run once at startup so misconfiguration
 * fails fast with a readable message instead of surfacing as a cryptic runtime
 * error later. App-wide vars are checked here; RAG-specific vars are validated
 * by the sources domain's own schema (`loadRagConfig`).
 */
const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
});

export function validateEnv(env: Record<string, string | undefined> = process.env): void {
  const issues: string[] = [];

  const result = schema.safeParse(env);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  try {
    loadRagConfig(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  try {
    loadTelemetryConfig(env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  if (issues.length) {
    throw new Error(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
  }
}
