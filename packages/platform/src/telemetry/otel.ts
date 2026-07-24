import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { configureTelemetry } from "./trace";

let sdk: NodeSDK | undefined;

export type TelemetryConfig = {
  captureContent: boolean;
  redactPii: boolean;
} & (
  | { enabled: false }
  | {
      enabled: true;
      endpoint: string;
      headers: Record<string, string>;
      serviceName: string;
    }
);

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function startTelemetry(config: TelemetryConfig, serviceVersion: string): void {
  configureTelemetry({ captureContent: config.captureContent, redactPii: config.redactPii });
  if (!config.enabled) return;

  const base = trimSlash(config.endpoint);
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
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

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch {}
  sdk = undefined;
}
