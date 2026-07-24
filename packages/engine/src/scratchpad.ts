import { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";

export const UPDATE_SCRATCHPAD_NAME = "update_scratchpad" as const;

const parameters = z.object({
  sections: z
    .array(
      z.object({
        section: z
          .string()
          .min(1)
          .describe(
            "Section name you choose, e.g. todo, plan, findings. Reusing a name replaces it.",
          ),
        content: z
          .string()
          .nullable()
          .describe(
            "The section's full new text (markdown/list/YAML), or null to remove the section.",
          ),
      }),
    )
    .min(1)
    .describe("One or more sections to write. Each write replaces that whole section."),
});

export type UpdateScratchpadArgs = z.infer<typeof parameters>;

export function parseScratchpadArgs(argsJson: string): UpdateScratchpadArgs {
  return parameters.parse(JSON.parse(argsJson));
}

const intercepted = async (): Promise<string> => {
  throw new Error(`${UPDATE_SCRATCHPAD_NAME} is handled by the runner, not executed`);
};

export const updateScratchpadTool: ToolDefinition<typeof parameters> = {
  name: UPDATE_SCRATCHPAD_NAME,
  label: "Updating scratchpad",
  description:
    "Record or revise your private working state — a todo list, a discovery plan, running " +
    "notes, or interim findings — so it survives across steps without cluttering the reply. " +
    "You name the sections; writing a section replaces it, content null removes it. The " +
    "current scratchpad is shown back to you each step. Keep it small and current.",
  parameters,
  execute: intercepted,
  summarize: ({ sections }) => sections.map((s) => s.section).join(", "),
};
