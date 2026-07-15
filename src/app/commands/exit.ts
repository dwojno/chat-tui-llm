import type { Command } from "./types";

export const exitCommand: Command = {
  name: "exit",
  matches: (input) => input === "exit",
  run: () => ({ kind: "exit" }),
};
