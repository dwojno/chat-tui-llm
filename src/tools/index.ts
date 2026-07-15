import type { z } from "zod";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "../agent/tools/types";
import type { OpenAITool } from "../agent/tools/types";
import { FORK_MODEL } from "../config";
import type { Store } from "../store";
import { askUserTool } from "./ask-user";
import { controlIntentTools } from "./control-intents";
import { delegateTaskTool } from "./delegation/delegate-task";
import { delegateTasksTool } from "./delegation/delegate-tasks";
import { FORK_INSTRUCTIONS } from "./prompts/fork";
import { RAG_FORK_INSTRUCTIONS } from "./prompts/rag-fork";
import { editFileTool } from "./edit-file";
import { createRagTools } from "./rag";
import { readFileTool } from "./read-file";
import { requestApprovalTool } from "./request-approval";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";
import { writeFileTool } from "./write-file";

export { weatherTool } from "./weather";
export { webSearchTool } from "./web-search";
export { delegateTaskTool } from "./delegation/delegate-task";
export { delegateTasksTool } from "./delegation/delegate-tasks";
export { requestApprovalTool } from "./request-approval";
export { askUserTool } from "./ask-user";
export { readFileTool } from "./read-file";
export { writeFileTool } from "./write-file";
export { editFileTool } from "./edit-file";
export {
  controlIntentTools,
  doneForNowTool,
  requestMoreInformationTool,
  CONTROL_INTENT_NAMES,
  isControlIntent,
  DONE_FOR_NOW_NAME,
  REQUEST_MORE_INFORMATION_NAME,
} from "./control-intents";

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
  ...controlIntentTools,
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
