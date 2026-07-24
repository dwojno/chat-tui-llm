import { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";
import { DELEGATE_TASK_NAME, runFork } from "./delegate-task";
import { profileArg } from "./profiles";

export const DELEGATE_TASKS_NAME = "delegate_tasks" as const;

export const FORK_TOOL_NAMES = new Set<string>([DELEGATE_TASK_NAME, DELEGATE_TASKS_NAME]);

const MAX_PARALLEL_TASKS = 6;

const parameters = z.object({
  tasks: z
    .array(
      z.object({
        title: z
          .string()
          .min(1)
          .describe("Short label for this sub-task (a few words) — shown to the user."),
        task: z
          .string()
          .min(1)
          .describe("Self-contained brief for this sub-task; the fork sees only this."),
        relevantMemoryKeys: z
          .array(z.string())
          .nullable()
          .describe(
            "Keys (M1, M2, …) from <user_known_memories> this sub-task needs, or " +
              "null/[] for none.",
          ),
        profile: profileArg,
      }),
    )
    .min(1)
    .max(MAX_PARALLEL_TASKS)
    .describe(
      `Independent sub-tasks to run as parallel sub-agents (1–${MAX_PARALLEL_TASKS}). ` +
        "Use only for genuinely independent work; for a single sub-task use delegate_task.",
    ),
});

export type DelegateTasksArgs = z.infer<typeof parameters>;

export function parseDelegateTasksArgs(argsJson: string): DelegateTasksArgs {
  return parameters.parse(JSON.parse(argsJson));
}

export function createDelegateTasksTool(handoffModel: string): ToolDefinition<typeof parameters> {
  return {
    name: DELEGATE_TASKS_NAME,
    label: "Delegating",
    description:
      "Fan out several INDEPENDENT sub-tasks to parallel sub-agents in one call. " +
      `Provide a \`tasks\` array (1–${MAX_PARALLEL_TASKS}), each with a short ` +
      "`title`, a self-contained `task` brief, the `relevantMemoryKeys` it needs " +
      "(or null), and an optional `profile` selecting the specialist for that " +
      "sub-task. Returns a JSON array of fork_result digests in task order. " +
      "Use for parallel research/comparison; use delegate_task for a single " +
      "sub-task and answer simple lookups directly.",
    parameters,
    execute: async ({ tasks }, ctx) => {
      if (!ctx) throw new Error(`${DELEGATE_TASKS_NAME} requires a tool context`);
      const forkResults = await Promise.all(
        tasks.map((task) => runFork({ ctx, handoffModel, ...task })),
      );
      return JSON.stringify(forkResults);
    },
    summarize: ({ tasks }) => tasks.map((t) => t.title).join(", "),
    requiresApproval: true,
  };
}
