import type { Command } from "./types";

/** `exit` — leave the REPL. */
export const exitCommand: Command = {
  name: "exit",
  matches: (input) => input === "exit",
  run: () => ({ kind: "exit" }),
};
