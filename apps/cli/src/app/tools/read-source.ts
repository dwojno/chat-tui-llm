import { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";
import type { ReadRange, Store } from "@/store";

export const READ_SOURCE_NAME = "read_source" as const;

const parameters = z.object({
  path: z.string().min(1).describe("Indexed source file path"),
  mode: z.enum(["lines", "bytes"]).describe("Read a line range or a byte range"),
  start: z.number().int().min(0).describe("1-based start line, or start byte offset"),
  end: z
    .number()
    .int()
    .min(0)
    .describe(
      "Inclusive end line, or end byte offset. To read a whole file, pass start=1 " +
        "and a large end (e.g. 100000).",
    ),
});

export function createReadSourceTool(store: Store): ToolDefinition<typeof parameters> {
  return {
    name: READ_SOURCE_NAME,
    label: "Reading knowledge base file",
    description:
      "Read a slice of an indexed source file (converted Markdown) — a line range " +
      "(mode=lines) or byte range (mode=bytes). After search_knowledge_base points " +
      "you at a file, read the relevant portion (or the whole file) here to get the " +
      "content you answer from; do not answer from the search preview alone.",
    parameters,
    async execute({ path, mode, start, end }): Promise<string> {
      const range: ReadRange =
        mode === "bytes" ? { kind: "bytes", start, end } : { kind: "lines", start, end };
      const content = await store.sources.readFile(store.profileId, path, range);
      return content || "(empty range)";
    },
    summarize: ({ path }) => path,
  };
}
