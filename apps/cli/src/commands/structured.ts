import { DEFAULT_TURN_OPTIONS } from "@chat/agent/conversation/options";
import { ResponseSchema } from "@chat/engine";
import type { Command } from "./types";

const PREFIX = "/structured ";

export const structuredCommand: Command = {
  name: "structured",
  completion: PREFIX,
  hint: "answer validated against a schema (answer + sources)",
  matches: (input) => input.startsWith(PREFIX),
  run: async (input) => ({
    kind: "turn",
    content: input.slice(PREFIX.length).trim(),
    options: {
      ...DEFAULT_TURN_OPTIONS,
      structured_output: ResponseSchema,
    },
  }),
};
