import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { TurnEvent } from "../../agent/events/events";
import type { ToolDefinition } from "../../agent/tools/types";
import { resolveWithinCwd } from "./utils/workspace";

export const EDIT_FILE_NAME = "edit_file" as const;

const parameters = z.object({
  path: z.string().min(1).describe("File path relative to the working directory"),
  oldString: z
    .string()
    .min(1)
    .describe("Exact text to replace. Must appear EXACTLY ONCE in the file."),
  newString: z.string().describe("Replacement text (must differ from oldString)"),
});

export type EditFileArgs = z.infer<typeof parameters>;

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

async function* execute({
  path,
  oldString,
  newString,
}: EditFileArgs): AsyncGenerator<TurnEvent, string> {
  if (oldString === newString) return "oldString and newString are identical; nothing to change.";
  const absolute = resolveWithinCwd(path);

  let content: string;
  try {
    content = await readFile(absolute, "utf8");
  } catch (error) {
    return `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }

  const count = occurrences(content, oldString);
  if (count === 0) return `oldString not found in ${path}; no change made.`;
  if (count > 1) {
    return `oldString is not unique in ${path} (${count} matches); add more context to disambiguate.`;
  }

  try {
    await writeFile(absolute, content.replace(oldString, newString), "utf8");
  } catch (error) {
    return `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `Edited ${path}.`;
}

export const editFileTool: ToolDefinition<typeof parameters> = {
  name: EDIT_FILE_NAME,
  label: "Editing file",
  description:
    "Replace an exact, unique snippet in a working-directory file: oldString must " +
    "appear exactly once (include surrounding context to make it unique). Paths " +
    "escaping the project are rejected. This mutates the user's files and pauses " +
    "for approval.",
  parameters,
  execute,
  approvalPolicy: ({ path }) => ({
    required: true,
    reason: `Edit file ${path}`,
    risk: "medium",
  }),
  summarize: ({ path }) => path,
};
