import { DEFAULT_TURN_OPTIONS } from "../agent/conversation/options";
import type { Command } from "./types";

const PREFIX = "/json ";

export const jsonCommand: Command = {
  name: "json",
  completion: PREFIX,
  hint: "answer in raw JSON mode",
  matches: (input) => input.startsWith(PREFIX),
  run: async (input) => {
    const prompt = input.slice(PREFIX.length).trim();
    return {
      kind: "turn",
      content: `${prompt}\n\nRespond in JSON format.`,
      options: {
        ...DEFAULT_TURN_OPTIONS,
        json_mode: true,
      },
    };
  },
};
