import { config } from "dotenv";
import { loadTelemetryConfig } from "@/platform/telemetry/config";
import { shutdownTelemetry, startTelemetry } from "@/platform/telemetry/otel";
import { run } from "@/main";

config();
startTelemetry(loadTelemetryConfig());

run()
  .catch(console.error)
  .finally(() => shutdownTelemetry());
