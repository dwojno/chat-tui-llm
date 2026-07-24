import type { z } from "zod";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "@chat/agent/tools/types";
import type { OpenAITool } from "@chat/agent/tools/types";
import { controlIntentTools, updateScratchpadTool } from "@chat/engine";
import type { Store } from "@chat/store";
import { askUserTool } from "./ask-user";
import { createDelegateTaskTool } from "./delegation/delegate-task";
import { createDelegateTasksTool } from "./delegation/delegate-tasks";
import { FORK_PROFILE_META, FORK_PROFILE_NAMES } from "./delegation/profiles";
import { editFileTool } from "./edit-file";
import { readFileTool } from "./read-file";
import { createWebSearchTool, type WebSearchConfig } from "./web-search";
import { writeFileTool } from "./write-file";

export { createWebSearchTool } from "./web-search";
export { createDelegateTaskTool } from "./delegation/delegate-task";
export { createDelegateTasksTool } from "./delegation/delegate-tasks";
export { askUserTool } from "./ask-user";
export { readFileTool } from "./read-file";
export { writeFileTool } from "./write-file";
export { editFileTool } from "./edit-file";
export {
  updateScratchpadTool,
  UPDATE_SCRATCHPAD_NAME,
  controlIntentTools,
  doneForNowTool,
  requestMoreInformationTool,
  CONTROL_INTENT_NAMES,
  isControlIntent,
  DONE_FOR_NOW_NAME,
  REQUEST_MORE_INFORMATION_NAME,
} from "@chat/engine";

export interface AgentTools {
  tools: ToolDefinition<z.ZodType>[];
  forkProfiles: ForkProfiles;
}

export interface CreateAgentToolsArgs {
  store: Store;
  forkModel: string;
  handoffModel: string;
  webSearch: WebSearchConfig;
  mcpTools?: ToolDefinition<z.ZodType>[];
  extraTools?: ToolDefinition<z.ZodType>[];
}

export function createAgentTools({
  store,
  forkModel,
  handoffModel,
  webSearch,
  mcpTools = [],
  extraTools = [],
}: CreateAgentToolsArgs): AgentTools {
  const delegateTaskTool = createDelegateTaskTool(handoffModel);
  const delegateTasksTool = createDelegateTasksTool(handoffModel);
  const webSearchTool = createWebSearchTool(webSearch);
  const mainTools: ToolDefinition<z.ZodType>[] = [
    delegateTaskTool,
    delegateTasksTool,
    askUserTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    updateScratchpadTool,
    ...controlIntentTools,
  ];
  const forkProfiles = Object.fromEntries(
    FORK_PROFILE_NAMES.map((name) => [
      name,
      {
        instructions: FORK_PROFILE_META[name].instructions,
        tools:
          name === "general"
            ? [...FORK_PROFILE_META[name].tools(store, webSearchTool), ...extraTools]
            : FORK_PROFILE_META[name].tools(store, webSearchTool),
        model: forkModel,
      },
    ]),
  ) as ForkProfiles;
  return { tools: [...mainTools, ...mcpTools, ...extraTools], forkProfiles };
}

export const createForkToolSchemas = (webSearch: WebSearchConfig): OpenAITool[] => [
  toOpenAITool(createWebSearchTool(webSearch)),
];

export const createMainToolSchemas = (handoffModel: string): OpenAITool[] =>
  (
    [
      createDelegateTaskTool(handoffModel),
      createDelegateTasksTool(handoffModel),
      readFileTool,
      writeFileTool,
      editFileTool,
    ] as ToolDefinition<z.ZodType>[]
  ).map(toOpenAITool);
