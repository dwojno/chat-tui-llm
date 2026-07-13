import type { z } from "zod";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "../../agent/tools/types";
import type { OpenAITool } from "../../agent/conversation/turn";
import { FORK_MODEL } from "../../agent/config";
import { FORK_INSTRUCTIONS, RAG_FORK_INSTRUCTIONS } from "../../agent/prompts";
import type { Store } from "../../store";
import { createRagTools } from "../rag/tools";
import { askUserTool } from "./ask-user";
import { delegateTaskTool } from "./delegate-task";
import { delegateTasksTool } from "./delegate-tasks";
import { requestApprovalTool } from "./request-approval";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";

export { weatherTool } from "./weather";
export { webSearchTool } from "./web-search";
export { delegateTaskTool } from "./delegate-task";
export { delegateTasksTool } from "./delegate-tasks";
export { requestApprovalTool } from "./request-approval";
export { askUserTool } from "./ask-user";

export interface AgentTools {
  tools: ToolDefinition<z.ZodType>[];
  forkProfiles: ForkProfiles;
}

export function createAgentTools(store: Store): AgentTools {
  const ragTools = createRagTools(store);
  return {
    tools: [
      weatherTool,
      delegateTaskTool,
      delegateTasksTool,
      requestApprovalTool,
      askUserTool,
      ...ragTools,
    ],
    forkProfiles: {
      general: {
        instructions: FORK_INSTRUCTIONS,
        tools: [weatherTool, webSearchTool],
        model: FORK_MODEL,
      },
      rag_research: {
        instructions: RAG_FORK_INSTRUCTIONS,
        tools: ragTools,
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
  [weatherTool, delegateTaskTool, delegateTasksTool] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
