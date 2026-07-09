import type { z } from "zod";
import { toOpenAITool, type ToolDefinition } from "../../agent/tools/types";
import type { OpenAITool } from "../../agent/conversation/turn";
import type { Store } from "../../store";
import { createRagTools } from "../rag/tools";
import { delegateTaskTool } from "./delegate-task";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";

export { weatherTool } from "./weather";
export { webSearchTool } from "./web-search";
export { delegateTaskTool } from "./delegate-task";

export interface AgentTools {
  /** Tools the main agent may call. */
  tools: ToolDefinition<z.ZodType>[];
  /** Tools available to delegated sub-agents (no `delegate_task` — no recursion). */
  forkTools: ToolDefinition<z.ZodType>[];
}

/**
 * Composes every tool the agent runs, here at the integration level, and hands
 * them to `AgentService` via `AgentConfig`. The agent core owns none of these.
 */
export function createAgentTools(store: Store): AgentTools {
  return {
    tools: [weatherTool, delegateTaskTool, ...createRagTools(store)],
    forkTools: [weatherTool, webSearchTool],
  };
}

/** Fork tool schemas without a store — for evals/tests that probe fork behaviour. */
export const forkToolSchemas: OpenAITool[] = (
  [weatherTool, webSearchTool] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
/** Main tool schemas (generic subset, no store) — for evals/tests. */
export const mainToolSchemas: OpenAITool[] = (
  [weatherTool, delegateTaskTool] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
