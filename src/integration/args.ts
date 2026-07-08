import { parseArgs } from "node:util";
import { DEFAULT_TURN_OPTIONS } from "../agent/conversation/options";

export interface CliArgs {
  temperature: number;
}

const USAGE = `Usage: chat-cli [options]

Options:
  -t, --temperature <number>   Sampling temperature for every turn (default: ${DEFAULT_TURN_OPTIONS.temperature})
  -h, --help                   Show this help and exit`;

export function parseCliArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const values = parseRaw(argv);

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  return { temperature: parseTemperature(values.temperature) };
}

function parseRaw(argv: readonly string[]): {
  temperature?: string;
  help?: boolean;
} {
  try {
    return parseArgs({
      args: [...argv],
      options: {
        temperature: { type: "string", short: "t" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`${message}\n\n${USAGE}`);
  }
}

function parseTemperature(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_TURN_OPTIONS.temperature;
  }

  const value = Number(raw);
  if (Number.isNaN(value)) {
    return fail(`Invalid --temperature: ${JSON.stringify(raw)} is not a number.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
