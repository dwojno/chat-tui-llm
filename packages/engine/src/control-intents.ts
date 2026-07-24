import { z } from "zod";
import type { ToolDefinition } from "@chat/agent";

export const DONE_FOR_NOW_NAME = "done_for_now" as const;
export const REQUEST_MORE_INFORMATION_NAME = "request_more_information" as const;

export const CONTROL_INTENT_NAMES: ReadonlySet<string> = new Set([
  DONE_FOR_NOW_NAME,
  REQUEST_MORE_INFORMATION_NAME,
]);

export function isControlIntent(name: string): boolean {
  return CONTROL_INTENT_NAMES.has(name);
}

const doneParameters = z.object({
  answer: z.string().min(1).describe("The final, user-facing answer, in full."),
  sources: z
    .array(z.string().min(1))
    .nullable()
    .describe("Source citations (paths or URLs) backing the answer, or null when there are none."),
});

export type DoneForNowArgs = z.infer<typeof doneParameters>;

export function parseDoneForNowArgs(argsJson: string): DoneForNowArgs {
  return doneParameters.parse(JSON.parse(argsJson));
}

const clarifyParameters = z.object({
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

export type RequestMoreInformationArgs = z.infer<typeof clarifyParameters>;

export function parseRequestMoreInformationArgs(argsJson: string): RequestMoreInformationArgs {
  return clarifyParameters.parse(JSON.parse(argsJson));
}

const intercepted = (name: string) => async (): Promise<string> => {
  throw new Error(`${name} is a control intent and must be handled by the runner, not executed`);
};

export const doneForNowTool: ToolDefinition<typeof doneParameters> = {
  name: DONE_FOR_NOW_NAME,
  label: "Answering",
  description:
    "Finish the turn with your final answer. Use this instead of a plain reply when the " +
    "answer should carry explicit `sources` (e.g. after searching a knowledge base) or a " +
    "caller expects a structured result. Provide the complete `answer` and any `sources`.",
  parameters: doneParameters,
  execute: intercepted(DONE_FOR_NOW_NAME),
  summarize: () => "final answer",
};

export const requestMoreInformationTool: ToolDefinition<typeof clarifyParameters> = {
  name: REQUEST_MORE_INFORMATION_NAME,
  label: "Asking you a question",
  description:
    "Pause and ask the user a question when the request is ambiguous or you are missing " +
    "information needed to proceed confidently. Provide one concise `question`; supply 2-4 " +
    "`options` when the answer is naturally a choice. The turn resumes with the user's reply.",
  parameters: clarifyParameters,
  execute: intercepted(REQUEST_MORE_INFORMATION_NAME),
  summarize: ({ question }) => question,
};

export const controlIntentTools: ToolDefinition<z.ZodType>[] = [
  doneForNowTool,
  requestMoreInformationTool,
];
