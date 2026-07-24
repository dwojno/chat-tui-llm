// oxlint-disable-next-line import/no-unassigned-import -- side-effect import must run before the config module evaluates
import "dotenv/config";
import { envConfig } from "@/platform/config";
import { shutdownTelemetry, startTelemetry } from "@/platform/telemetry/otel";
import { run } from "@/main";

startTelemetry(envConfig.telemetry);

run()
  .catch(console.error)
  .finally(() => shutdownTelemetry());
