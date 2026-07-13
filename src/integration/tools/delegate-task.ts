import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { z } from "zod";
import { CHEAP_MODEL } from "../../agent/config";
import { endSpan, recordLlmSpan, setSpanIO, startSpan, withSpan } from "../../agent/telemetry";
import { extractConversationSummary, keyMemories } from "../../agent/dynamicContext/context";
import { compressHandoff } from "../../agent/tools/utils/handoff";
import type { ForkResult } from "../../agent/tools/utils/fork-result";
import { DEFAULT_TURN_OPTIONS } from "../../agent/conversation/options";
import type { TurnEvent } from "../../agent/events/events";
import type { ToolRunContext, TurnProfile } from "../../agent/conversation/turn";
import {
  FORK_PROFILE_NAMES,
  toOpenAITool,
  type ForkProfileName,
  type ToolDefinition,
} from "../../agent/tools/types";

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
    .enum(FORK_PROFILE_NAMES)
    .nullable()
    .describe(
      'Which fork profile to run. "general" (web_search + weather) for open research; ' +
        '"rag_research" (knowledge-base tools) for multi-hop retrieval over indexed ' +
        'sources. null defaults to "general".',
    ),
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

function buildForkBrief(summary: string, memories: readonly string[], task: string): string {
  const parts = [
    summary ? `Parent context:\n${summary}` : "",
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

export async function* runFork(
  ctx: ToolRunContext,
  { title, task, relevantMemoryKeys, profile }: RunForkArgs,
): AsyncGenerator<TurnEvent, ForkResult> {
  const summary = extractConversationSummary(ctx.messages);
  const memories = selectMemories(ctx.context.memories, relevantMemoryKeys);
  const brief = buildForkBrief(summary, memories, task);
  const userMessage = {
    role: "user",
    content: brief,
  } satisfies ResponseInputItem;
  const childItems: ResponseInputItem[] = [userMessage];

  const forkProfile = ctx.forkProfiles[profile ?? "general"];
  const turnProfile: TurnProfile = {
    instructions: forkProfile.instructions,
    tools: forkProfile.tools.map(toOpenAITool),
    cacheKey: `chat-cli:fork:${randomUUID()}`,
    model: forkProfile.model,
  };

  return yield* withSpan(
    "chat.turn",
    {
      attributes: {
        "chat.fork.title": title,
        "chat.fork.profile": profile ?? "general",
        "chat.fork.memories": memories.length,
      },
      input: brief,
    },
    async function* (forkSpan) {
      for await (const event of ctx.runTurn(
        [userMessage],
        { ...DEFAULT_TURN_OPTIONS, stream: false },
        { memories },
        turnProfile,
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

      const handoffSpan = startSpan(`gen_ai.handoff ${CHEAP_MODEL}`, { parent: forkSpan });
      const { result, usage } = await compressHandoff(ctx.openai, childItems, "");
      recordLlmSpan(handoffSpan, {
        model: CHEAP_MODEL,
        operation: "handoff",
        usage,
        input: JSON.stringify(childItems),
        output: JSON.stringify(result),
      });
      handoffSpan.setAttribute("chat.fork.confidence", result.confidence);
      endSpan(handoffSpan);

      setSpanIO(forkSpan, { output: JSON.stringify(result) });
      yield { type: "usage", kind: "summarizer", usage };
      return result;
    },
  );
}

async function* execute(
  { title, task, relevantMemoryKeys, profile }: DelegateTaskArgs,
  ctx?: ToolRunContext,
): AsyncGenerator<TurnEvent, string> {
  if (!ctx) throw new Error(`${DELEGATE_TASK_NAME} requires a tool context`);
  const result = yield* runFork(ctx, { title, task, relevantMemoryKeys, profile });
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
  approvalPolicy: ({ task, relevantMemoryKeys }) =>
    !relevantMemoryKeys?.length && task.length > 600
      ? { required: true, reason: "Broad delegation with no referenced memories.", risk: "low" }
      : false,
};
