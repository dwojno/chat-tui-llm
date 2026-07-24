import assert from "node:assert";
import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { z } from "zod";
import { setSpanIO, withSpan } from "@/platform/telemetry";
import { withForkUsage } from "@/platform/model";
import { keyMemories } from "@/app/context/context";
import { compressHandoff } from "./handoff";
import type { ForkResult } from "./fork-result";
import { DEFAULT_TURN_OPTIONS } from "@chat/agent/conversation/options";
import type { ToolRunContext, TurnProfile } from "@chat/agent/conversation/turn";
import { toOpenAITool, type ToolDefinition } from "@chat/agent/tools/types";
import { profileArg, type ForkProfileName } from "./profiles";

export const DELEGATE_TASK_NAME = "delegate_task" as const;

const parameters = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      'A short label (a few words, e.g. "Compare SSR vs SSG") describing the ' +
        "sub-task — shown to the user. Not the full brief.",
    ),
  task: z.string().min(1).describe("Self-contained sub-task brief for the sub-agent to complete"),
  relevantMemoryKeys: z
    .array(z.string())
    .nullable()
    .describe(
      "Keys (M1, M2, …) of the stored memories from <user_known_memories> this " +
        "sub-task needs. The fork only sees the memories you list here — pass the " +
        "few that matter, or null/[] to pass none.",
    ),
  profile: profileArg,
});

export type DelegateTaskArgs = z.infer<typeof parameters>;

export function parseDelegateTaskArgs(argsJson: string): DelegateTaskArgs {
  return parameters.parse(JSON.parse(argsJson));
}

export function selectMemories(
  memories: readonly string[],
  keys: readonly string[] | null,
): string[] {
  if (!keys?.length) return [];
  const byKey = new Map(keyMemories(memories).map((m) => [m.key, m.text]));
  return keys.map((key) => byKey.get(key)).filter((text): text is string => text !== undefined);
}

function buildForkBrief(memories: readonly string[], task: string): string {
  const parts = [
    memories.length ? `Known memories:\n- ${memories.join("\n- ")}` : "",
    `Your task:\n${task}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

export interface RunForkArgs {
  title: string;
  task: string;
  relevantMemoryKeys: readonly string[] | null;
  profile?: ForkProfileName | null;
}

export async function runFork(
  ctx: ToolRunContext,
  { title, task, relevantMemoryKeys, profile }: RunForkArgs,
): Promise<ForkResult> {
  const memories = selectMemories(ctx.context.memories, relevantMemoryKeys);
  const brief = buildForkBrief(memories, task);
  const userMessage = {
    role: "user",
    content: brief,
  } satisfies ResponseInputItem;

  const forkProfile = ctx.forkProfiles[profile ?? "general"];
  assert(forkProfile !== undefined, `Unknown fork profile: ${profile ?? "general"}`);
  const turnProfile: TurnProfile = {
    instructions: forkProfile.instructions,
    tools: forkProfile.tools.map(toOpenAITool),
    cacheKey: `chat-cli:fork:${randomUUID()}`,
    model: forkProfile.model,
  };

  return withSpan(
    "chat.turn",
    {
      attributes: {
        "chat.fork.title": title,
        "chat.fork.profile": profile ?? "general",
        "chat.fork.memories": memories.length,
      },
      input: brief,
    },
    async (forkSpan) =>
      withForkUsage(async () => {
        const child = await ctx.runTurn({
          messages: [userMessage],
          options: { ...DEFAULT_TURN_OPTIONS, stream: false },
          context: { memories },
          profile: turnProfile,
          bus: ctx.bus.scoped(title),
        });

        const childItems = [userMessage, ...child.items];
        const { result } = await compressHandoff(ctx.model, childItems, "");
        forkSpan.setAttribute("chat.fork.confidence", result.confidence);
        setSpanIO(forkSpan, { output: JSON.stringify(result) });
        return result;
      }),
  );
}

async function execute(
  { title, task, relevantMemoryKeys, profile }: DelegateTaskArgs,
  ctx?: ToolRunContext,
): Promise<string> {
  if (!ctx) throw new Error(`${DELEGATE_TASK_NAME} requires a tool context`);
  const result = await runFork(ctx, { title, task, relevantMemoryKeys, profile });
  return JSON.stringify(result satisfies ForkResult);
}

export const delegateTaskTool: ToolDefinition<typeof parameters> = {
  name: DELEGATE_TASK_NAME,
  label: "Delegating",
  description:
    "Delegate a self-contained sub-task to a focused sub-agent. Provide a " +
    "short `title` for display, a self-contained `task` brief, and the " +
    "`relevantMemoryKeys` the sub-task needs (or null). Use for " +
    "multi-step research, exploratory work, or tasks that need several tool " +
    "calls. Call it several times in one response to fan out independent " +
    "sub-tasks to parallel sub-agents. Do not use for simple one-shot lookups " +
    "(e.g. a single fact check).",
  parameters,
  execute,
  summarize: ({ title }) => title,
  approvalPolicy: ({ task, relevantMemoryKeys }) =>
    !relevantMemoryKeys?.length && task.length > 600
      ? { required: true, reason: "Broad delegation with no referenced memories.", risk: "low" }
      : false,
};
