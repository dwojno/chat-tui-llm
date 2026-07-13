import type { z } from "zod";
import type { ToolDefinition } from "../../agent/tools/types";
import type { Store } from "../../store";
import { createGrepFilesTool } from "./grep-files";
import { createListSourcesTool } from "./list-sources";
import { createReadSourceTool } from "./read-source";
import { createSearchKnowledgeBaseTool } from "./search-knowledge-base";

/**
 * The knowledge-base tools, each closing over the live `Store` and calling
 * `store.sources.*` with the active profile. Wired into the `rag_research` fork
 * only — the main agent reaches the knowledge base by delegating to that fork.
 */
export function createRagTools(store: Store): ToolDefinition<z.ZodType>[] {
  return [
    createSearchKnowledgeBaseTool(store),
    createListSourcesTool(store),
    createGrepFilesTool(store),
    createReadSourceTool(store),
  ];
}
