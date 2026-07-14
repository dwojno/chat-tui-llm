import { config } from "dotenv";
import { loadTelemetryConfig } from "./telemetry/config";
import { shutdownTelemetry, startTelemetry } from "./telemetry/otel";
import { run } from "./main";

config();
startTelemetry(loadTelemetryConfig());

run()
  .catch(console.error)
  .finally(() => shutdownTelemetry());
