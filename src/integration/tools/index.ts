import type { z } from "zod";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "../../agent/tools/types";
import type { OpenAITool } from "../../agent/conversation/turn";
import { FORK_MODEL } from "../../agent/config";
import { FORK_INSTRUCTIONS, RAG_FORK_INSTRUCTIONS } from "../../agent/prompts";
import type { Store } from "../../store";
import { askUserTool } from "./ask-user";
import { delegateTaskTool } from "./delegate-task";
import { delegateTasksTool } from "./delegate-tasks";
import { editFileTool } from "./edit-file";
import { createRagTools } from "./rag";
import { readFileTool } from "./read-file";
import { requestApprovalTool } from "./request-approval";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";
import { writeFileTool } from "./write-file";

export { weatherTool } from "./weather";
export { webSearchTool } from "./web-search";
export { delegateTaskTool } from "./delegate-task";
export { delegateTasksTool } from "./delegate-tasks";
export { requestApprovalTool } from "./request-approval";
export { askUserTool } from "./ask-user";
export { readFileTool } from "./read-file";
export { writeFileTool } from "./write-file";
export { editFileTool } from "./edit-file";

export interface AgentTools {
  tools: ToolDefinition<z.ZodType>[];
  forkProfiles: ForkProfiles;
}

// Disk tools are main-only; knowledge-base tools are fork-only. The main agent
// reaches the knowledge base by delegating to the rag_research fork — keeping raw
// chunks out of the orchestrator's context.
const mainTools: ToolDefinition<z.ZodType>[] = [
  weatherTool,
  delegateTaskTool,
  delegateTasksTool,
  requestApprovalTool,
  askUserTool,
  readFileTool,
  writeFileTool,
  editFileTool,
];

export function createAgentTools(store: Store): AgentTools {
  return {
    tools: mainTools,
    forkProfiles: {
      general: {
        instructions: FORK_INSTRUCTIONS,
        tools: [weatherTool, webSearchTool],
        model: FORK_MODEL,
      },
      rag_research: {
        instructions: RAG_FORK_INSTRUCTIONS,
        tools: createRagTools(store),
        model: FORK_MODEL,
      },
    },
  };
}

/** General-fork tool schemas without a store — for evals/tests that probe fork behaviour. */
export const forkToolSchemas: OpenAITool[] = (
  [weatherTool, webSearchTool] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
/** Main tool schemas (generic subset, no store) — for evals/tests. */
export const mainToolSchemas: OpenAITool[] = (
  [
    weatherTool,
    delegateTaskTool,
    delegateTasksTool,
    readFileTool,
    writeFileTool,
    editFileTool,
  ] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
