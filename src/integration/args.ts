import { parseArgs } from "node:util";

export interface CliArgs {
  conversationId?: string | undefined;
}

const USAGE = `Usage: chat-cli [options]

Options:
  -c, --conversation <uuid>    Restore a previous conversation by id
  -h, --help                   Show this help and exit`;

export function parseCliArgs(argv: readonly string[] = process.argv.slice(2)): CliArgs {
  const values = parseRaw(argv);

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const conversationId = values.conversation?.trim() || undefined;
  return conversationId !== undefined ? { conversationId } : {};
}

function parseRaw(argv: readonly string[]): {
  conversation?: string;
  help?: boolean;
} {
  try {
    return parseArgs({
      args: [...argv],
      options: {
        conversation: { type: "string", short: "c" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`${message}\n\n${USAGE}`);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
