import { z } from "zod";
import type { ToolRunContext } from "@chat/agent/conversation/turn";
import type { ToolDefinition } from "@chat/agent/tools/types";
import { CLARIFICATION_UNANSWERED_OUTPUT } from "@chat/agent/humanLayer/clarification";

export const ASK_USER_NAME = "ask_user" as const;

const parameters = z.object({
  question: z
    .string()
    .min(1)
    .describe("The single, specific question to ask the user, in plain language."),
  reason: z
    .string()
    .nullable()
    .describe("A short note on why you need this before proceeding, or null."),
  options: z
    .array(z.string().min(1))
    .max(4)
    .nullable()
    .describe(
      "2-4 preset answers when the reply is naturally a choice, or null. The user " +
        "may still type their own answer instead.",
    ),
});

export type AskUserArgs = z.infer<typeof parameters>;

async function execute(
  { question, reason, options }: AskUserArgs,
  ctx?: ToolRunContext,
): Promise<string> {
  if (!ctx?.requestClarification) {
    return "No human is available to answer right now; proceed using your best judgement, and state any assumptions you make.";
  }
  ctx.bus.emit({ type: "status", text: "Waiting for your answer…" });
  const { answer } = await ctx.requestClarification({
    question,
    ...(reason ? { reason } : {}),
    ...(options?.length ? { options } : {}),
  });
  return answer === null ? CLARIFICATION_UNANSWERED_OUTPUT : `The user answered: "${answer}"`;
}

export const askUserTool: ToolDefinition<typeof parameters> = {
  name: ASK_USER_NAME,
  label: "Asking you a question",
  description:
    "Pause and ask the user a question when the request is ambiguous or you are " +
    "missing information needed to proceed confidently. Provide one concise " +
    "`question`; supply 2-4 `options` when the answer is naturally a choice. " +
    "Returns the user's answer.",
  parameters,
  execute,
  summarize: ({ question }) => question,
};
