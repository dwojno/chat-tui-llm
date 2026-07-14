import { createRequire } from "node:module";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { configureTelemetry } from "./trace";
import type { TelemetryConfig } from "./config";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

let sdk: NodeSDK | undefined;

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function startTelemetry(config: TelemetryConfig): void {
  configureTelemetry({ captureContent: config.captureContent });
  if (!config.enabled) return;

  const base = trimSlash(config.endpoint);
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: version,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${base}/v1/traces`,
      headers: config.headers,
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${base}/v1/metrics`,
        headers: config.headers,
      }),
    }),
  });
  sdk.start();
}

/** Drain the batch processor before the process exits — short CLI runs would otherwise lose spans. */
export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {
    // Ignore flush failures on shutdown; nothing actionable at exit.
  }
  sdk = undefined;
}
