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
  TAVILY_API_KEY: z.string().optional(),
  WEB_SEARCH_MAX_RESULTS: z
    .string()
    .optional()
    .refine((v) => v == null || v === "" || (Number.isInteger(Number(v)) && Number(v) > 0), {
      message: "WEB_SEARCH_MAX_RESULTS must be a positive integer",
    }),
});

export function approvalsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.CHAT_APPROVALS_DISABLED?.trim().toLowerCase();
  const disabled = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  return !disabled;
}

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
