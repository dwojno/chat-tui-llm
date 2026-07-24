import type { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";
import type { Store } from "@/store";
import { createGrepFilesTool } from "./grep-files";
import { createListSourcesTool } from "./list-sources";
import { createReadSourceTool } from "./read-source";
import { createSearchKnowledgeBaseTool } from "./search-knowledge-base";

export function createRagTools(store: Store): ToolDefinition<z.ZodType>[] {
  return [
    createSearchKnowledgeBaseTool(store),
    createListSourcesTool(store),
    createGrepFilesTool(store),
    createReadSourceTool(store),
  ];
}
