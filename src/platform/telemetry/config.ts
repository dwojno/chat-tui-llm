import { z } from "zod";

/**
 * OpenTelemetry configuration, validated once at startup (mirrors the RAG
 * domain's `loadRagConfig`). The exporter is vendor-neutral: point the standard
 * `OTEL_EXPORTER_OTLP_*` vars at self-hosted Langfuse, LangSmith, or any OTLP
 * collector. Telemetry is off unless `OTEL_ENABLED` is truthy, so nothing
 * changes for offline runs and tests.
 */
const schema = z.object({
  OTEL_ENABLED: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_CAPTURE_CONTENT: z.string().optional(),
});

export interface TelemetryConfig {
  enabled: boolean;
  endpoint: string;
  headers: Record<string, string>;
  serviceName: string;
  captureContent: boolean;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function parseHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!value) return headers;
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (key) headers[key] = val;
  }
  return headers;
}

export function loadTelemetryConfig(env: NodeJS.ProcessEnv = process.env): TelemetryConfig {
  const parsed = schema.parse(env);
  return {
    enabled: parseBool(parsed.OTEL_ENABLED, false),
    endpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:3000/api/public/otel",
    headers: parseHeaders(parsed.OTEL_EXPORTER_OTLP_HEADERS),
    serviceName: parsed.OTEL_SERVICE_NAME ?? "chat-cli",
    captureContent: parseBool(parsed.OTEL_CAPTURE_CONTENT, true),
  };
}
