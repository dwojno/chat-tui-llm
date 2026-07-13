import { config } from "dotenv";
import { loadTelemetryConfig } from "./integration/telemetry/config";
import { shutdownTelemetry, startTelemetry } from "./integration/telemetry/otel";
import { run } from "./main";

config();
startTelemetry(loadTelemetryConfig());

run()
  .catch(console.error)
  .finally(() => shutdownTelemetry());
