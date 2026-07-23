import type { z } from "zod";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "@/agent/tools/types";
import type { OpenAITool } from "@/agent/tools/types";
import { FORK_MODEL } from "@/app/config";
import type { Store } from "@/store";
import { askUserTool } from "./ask-user";
import { controlIntentTools } from "./control-intents";
import { delegateTaskTool } from "./delegation/delegate-task";
import { delegateTasksTool } from "./delegation/delegate-tasks";
import { FORK_PROFILE_META, FORK_PROFILE_NAMES } from "./delegation/profiles";
import { editFileTool } from "./edit-file";
import { readFileTool } from "./read-file";
import { updateScratchpadTool } from "./scratchpad";
import { webSearchTool } from "./web-search";
import { writeFileTool } from "./write-file";

export { webSearchTool } from "./web-search";
export { delegateTaskTool } from "./delegation/delegate-task";
export { delegateTasksTool } from "./delegation/delegate-tasks";
export { askUserTool } from "./ask-user";
export { readFileTool } from "./read-file";
export { writeFileTool } from "./write-file";
export { editFileTool } from "./edit-file";
export { updateScratchpadTool, UPDATE_SCRATCHPAD_NAME } from "./scratchpad";
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

export function createAgentTools(
  store: Store,
  mcpTools: ToolDefinition<z.ZodType>[] = [],
  extraTools: ToolDefinition<z.ZodType>[] = [],
): AgentTools {
  const forkProfiles = Object.fromEntries(
    FORK_PROFILE_NAMES.map((name) => [
      name,
      {
        instructions: FORK_PROFILE_META[name].instructions,
        tools:
          name === "general"
            ? [...FORK_PROFILE_META[name].tools(store), ...extraTools]
            : FORK_PROFILE_META[name].tools(store),
        model: FORK_MODEL,
      },
    ]),
  ) as ForkProfiles;
  return { tools: [...mainTools, ...mcpTools, ...extraTools], forkProfiles };
}

export const forkToolSchemas: OpenAITool[] = ([webSearchTool] as ToolDefinition<z.ZodType>[]).map(
  toOpenAITool,
);
export const mainToolSchemas: OpenAITool[] = (
  [
    delegateTaskTool,
    delegateTasksTool,
    readFileTool,
    writeFileTool,
    editFileTool,
  ] as ToolDefinition<z.ZodType>[]
).map(toOpenAITool);
