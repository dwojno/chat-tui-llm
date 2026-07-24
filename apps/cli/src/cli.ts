// oxlint-disable-next-line import/no-unassigned-import -- side-effect import must run before the config module evaluates
import "dotenv/config";
import { createRequire } from "node:module";
import { loadConfig } from "@/config";
import { shutdownTelemetry, startTelemetry } from "@chat/platform/telemetry/otel";
import { run } from "@/main";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
const envConfig = loadConfig();

startTelemetry(envConfig.telemetry, version);

run()
  .catch(console.error)
  .finally(() => shutdownTelemetry());
