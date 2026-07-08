import { DEFAULT_TURN_OPTIONS } from "../../agent/conversation/options";
import { ResponseSchema } from "../../agent/tools/utils/schemas";
import type { Command } from "./types";

const PREFIX = "/structured ";

export const structuredCommand: Command = {
  name: "structured",
  completion: PREFIX,
  hint: "answer validated against a schema (answer + sources)",
  matches: (input) => input.startsWith(PREFIX),
  run: (input, { temperature }) => ({
    kind: "turn",
    content: input.slice(PREFIX.length).trim(),
    options: {
      ...DEFAULT_TURN_OPTIONS,
      temperature,
      structured_output: ResponseSchema,
    },
  }),
};
