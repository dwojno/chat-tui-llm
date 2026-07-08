import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { z } from "zod";
import { extractConversationSummary } from "../dynamicContext/context";
import { FORK_INSTRUCTIONS } from "../prompts";
import { compressHandoff } from "./utils/handoff";
import { DEFAULT_TURN_OPTIONS } from "../conversation/options";
import type { TurnEvent } from "../events/events";
import type { ToolRunContext, TurnProfile } from "../conversation/turn";
import { toOpenAITool, type ToolDefinition } from "./types";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";

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
});

export function parseDelegateTaskArgs(argsJson: string): z.infer<typeof parameters> {
  return parameters.parse(JSON.parse(argsJson));
}

export const forkTools = [toOpenAITool(weatherTool), toOpenAITool(webSearchTool)];

function buildForkBrief(summary: string, facts: readonly string[], task: string): string {
  const parts = [
    summary ? `Parent context:\n${summary}` : "",
    facts.length ? `Known facts:\n- ${facts.join("\n- ")}` : "",
    `Your task:\n${task}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

function formatHandoff(task: string, digest: string): string {
  return [
    "<fork_handoff>",
    `Task: ${task}`,
    "Sub-agent completed. Use this as background — do not mention the fork unless asked.",
    "",
    digest,
    "</fork_handoff>",
  ].join("\n");
}

async function* execute(
  { title, task }: z.infer<typeof parameters>,
  ctx?: ToolRunContext,
): AsyncGenerator<TurnEvent, string> {
  if (!ctx) throw new Error(`${DELEGATE_TASK_NAME} requires a tool context`);

  const summary = extractConversationSummary(ctx.messages);
  const brief = buildForkBrief(summary, ctx.context.facts, task);
  const userMessage = {
    role: "user",
    content: brief,
  } satisfies ResponseInputItem;
  const childItems: ResponseInputItem[] = [userMessage];

  const profile: TurnProfile = {
    instructions: FORK_INSTRUCTIONS,
    tools: forkTools,
    cacheKey: `chat-cli:fork:${randomUUID()}`,
  };

  for await (const event of ctx.runTurn(
    [userMessage],
    { ...DEFAULT_TURN_OPTIONS, stream: false },
    { facts: ctx.context.facts },
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

  const { text, usage } = await compressHandoff(ctx.openai, childItems, "");
  yield { type: "usage", kind: "summarizer", usage };
  return formatHandoff(task, text);
}

export const delegateTaskTool: ToolDefinition<typeof parameters> = {
  name: DELEGATE_TASK_NAME,
  label: "Delegating",
  description:
    "Delegate a self-contained sub-task to a focused sub-agent. Provide a " +
    "short `title` for display and a self-contained `task` brief. Use for " +
    "multi-step research, exploratory work, or tasks that need several tool " +
    "calls. Call it several times in one response to fan out independent " +
    "sub-tasks to parallel sub-agents. Do not use for simple one-shot lookups " +
    "(e.g. a single weather check).",
  parameters,
  execute,
  summarize: ({ title }) => title,
};
