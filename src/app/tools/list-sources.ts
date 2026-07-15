import { z } from "zod";
import type { ToolDefinition } from "@/agent/tools/types";
import type { Store } from "@/store";

export const LIST_SOURCES_NAME = "list_files" as const;

const parameters = z.object({});

/** List the source files indexed in the current profile's knowledge base. */
export function createListSourcesTool(store: Store): ToolDefinition<typeof parameters> {
  return {
    name: LIST_SOURCES_NAME,
    label: "Listing knowledge base files",
    description: "List the source files indexed in the current profile's knowledge base.",
    parameters,
    async execute(): Promise<string> {
      const files = await store.sources.listFiles(store.profileId);
      return files.length
        ? ["Indexed files:", ...files.map((file) => `  - ${file}`)].join("\n")
        : "No files indexed yet. Use /learn @file to add one.";
    },
  };
}
