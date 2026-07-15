import { z } from "zod";
import type { ToolRunContext } from "@/agent/conversation/turn";
import type { ToolDefinition } from "@/agent/tools/types";
import { runFork } from "./delegate-task";

export const DELEGATE_TASKS_NAME = "delegate_tasks" as const;

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

async function execute({ tasks }: DelegateTasksArgs, ctx?: ToolRunContext): Promise<string> {
  if (!ctx) throw new Error(`${DELEGATE_TASKS_NAME} requires a tool context`);

  const forkResults = await Promise.all(
    tasks.map((t) =>
      runFork(ctx, {
        title: t.title,
        task: t.task,
        relevantMemoryKeys: t.relevantMemoryKeys,
      }),
    ),
  );
  return JSON.stringify(forkResults);
}

export const delegateTasksTool: ToolDefinition<typeof parameters> = {
  name: DELEGATE_TASKS_NAME,
  label: "Delegating",
  description:
    "Fan out several INDEPENDENT sub-tasks to parallel sub-agents in one call. " +
    `Provide a \`tasks\` array (1–${MAX_PARALLEL_TASKS}), each with a short ` +
    "`title`, a self-contained `task` brief, and the `relevantMemoryKeys` it " +
    "needs (or null). Returns a JSON array of fork_result digests in task order. " +
    "Use for parallel research/comparison; use delegate_task for a single " +
    "sub-task and answer simple lookups directly.",
  parameters,
  execute,
  summarize: ({ tasks }) => tasks.map((t) => t.title).join(", "),
  requiresApproval: true,
};
