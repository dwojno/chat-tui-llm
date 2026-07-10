import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { z } from "zod";
import { extractConversationSummary, keyMemories } from "../../agent/dynamicContext/context";
import { FORK_INSTRUCTIONS } from "../../agent/prompts";
import { compressHandoff } from "../../agent/tools/utils/handoff";
import type { ForkResult } from "../../agent/tools/utils/fork-result";
import { DEFAULT_TURN_OPTIONS } from "../../agent/conversation/options";
import type { TurnEvent } from "../../agent/events/events";
import type { ToolRunContext, TurnProfile } from "../../agent/conversation/turn";
import type { ToolDefinition } from "../../agent/tools/types";

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
  profile: z
    .enum(["general"])
    .nullable()
    .describe('Which fork profile to run. null defaults to "general".'),
});

export type DelegateTaskArgs = z.infer<typeof parameters>;

export function parseDelegateTaskArgs(argsJson: string): DelegateTaskArgs {
  return parameters.parse(JSON.parse(argsJson));
}

/** Resolve declared memory keys (M1, M2, …) back to their texts, order preserved. */
export function selectMemories(
  memories: readonly string[],
  keys: readonly string[] | null,
): string[] {
  if (!keys?.length) return [];
  const byKey = new Map(keyMemories(memories).map((m) => [m.key, m.text]));
  return keys.map((key) => byKey.get(key)).filter((text): text is string => text !== undefined);
}

function buildForkBrief(summary: string, memories: readonly string[], task: string): string {
  const parts = [
    summary ? `Parent context:\n${summary}` : "",
    memories.length ? `Known memories:\n- ${memories.join("\n- ")}` : "",
    `Your task:\n${task}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

async function* execute(
  { title, task, relevantMemoryKeys }: DelegateTaskArgs,
  ctx?: ToolRunContext,
): AsyncGenerator<TurnEvent, string> {
  if (!ctx) throw new Error(`${DELEGATE_TASK_NAME} requires a tool context`);

  const summary = extractConversationSummary(ctx.messages);
  const memories = selectMemories(ctx.context.memories, relevantMemoryKeys);
  const brief = buildForkBrief(summary, memories, task);
  const userMessage = {
    role: "user",
    content: brief,
  } satisfies ResponseInputItem;
  const childItems: ResponseInputItem[] = [userMessage];

  const profile: TurnProfile = {
    instructions: FORK_INSTRUCTIONS,
    tools: ctx.forkTools,
    cacheKey: `chat-cli:fork:${randomUUID()}`,
  };

  for await (const event of ctx.runTurn(
    [userMessage],
    { ...DEFAULT_TURN_OPTIONS, stream: false },
    { memories },
    profile,
  )) {
    switch (event.type) {
      case "message":
        childItems.push(event.item);
        break;
      case "usage":
        yield event;
        break;
      case "tool":
      case "status":
        yield { ...event, fork: title };
        break;
    }
  }

  const { result, usage } = await compressHandoff(ctx.openai, childItems, "");
  yield { type: "usage", kind: "summarizer", usage };
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
    "(e.g. a single weather check).",
  parameters,
  execute,
  summarize: ({ title }) => title,
};
