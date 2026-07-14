import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "../agent/tools/types";
import { resolveWithinCwd } from "./utils/workspace";

export const WRITE_FILE_NAME = "write_file" as const;

const parameters = z.object({
  path: z.string().min(1).describe("File path relative to the working directory"),
  content: z.string().describe("Full file contents to write (overwrites any existing file)"),
});

export type WriteFileArgs = z.infer<typeof parameters>;

async function execute({ path, content }: WriteFileArgs): Promise<string> {
  const absolute = resolveWithinCwd(path);
  try {
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  } catch (error) {
    return `Could not write ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `Wrote ${content.length} bytes to ${path}.`;
}

export const writeFileTool: ToolDefinition<typeof parameters> = {
  name: WRITE_FILE_NAME,
  label: "Writing file",
  description:
    "Create or overwrite a file in the working directory with the given content " +
    "(parent directories are created as needed). Paths escaping the project are " +
    "rejected. This mutates the user's files and pauses for approval.",
  parameters,
  execute,
  approvalPolicy: ({ path }) => ({
    required: true,
    reason: `Write file ${path}`,
    risk: "medium",
  }),
  summarize: ({ path }) => path,
};
