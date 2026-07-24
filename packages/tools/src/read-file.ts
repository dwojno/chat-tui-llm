import { open } from "node:fs/promises";
import { z } from "zod";
import type { ToolDefinition } from "@chat/agent/tools/types";
import { resolveWithinCwd } from "./utils/workspace";

export const READ_FILE_NAME = "read_file" as const;
const MAX_READ_BYTES = 256 * 1024;

const parameters = z.object({
  path: z.string().min(1).describe("File path relative to the working directory"),
  startLine: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe("1-based first line to return (null = from the start)"),
  endLine: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe("Inclusive last line to return (null = to the end)"),
});

export type ReadFileArgs = z.infer<typeof parameters>;

function sliceLines(content: string, startLine: number | null, endLine: number | null): string {
  if (startLine === null && endLine === null) return content;
  const lines = content.split("\n");
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);
  return lines.slice(start - 1, end).join("\n");
}

async function readCapped(absolute: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(absolute, "r");
  try {
    const buffer = Buffer.alloc(MAX_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
    const { size } = await handle.stat();
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: size > MAX_READ_BYTES,
    };
  } finally {
    await handle.close();
  }
}

async function execute({ path, startLine, endLine }: ReadFileArgs): Promise<string> {
  const absolute = resolveWithinCwd(path);
  let read: { text: string; truncated: boolean };
  try {
    read = await readCapped(absolute);
  } catch (error) {
    return `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const sliced = sliceLines(read.text, startLine, endLine) || "(empty range)";
  return read.truncated ? `${sliced}\n\n[truncated: file exceeds ${MAX_READ_BYTES} bytes]` : sliced;
}

export const readFileTool: ToolDefinition<typeof parameters> = {
  name: READ_FILE_NAME,
  label: "Reading file",
  description:
    "Read a file from the working directory as UTF-8 text, optionally limited to " +
    "a line range. Paths are resolved inside the project; paths escaping it are " +
    "rejected. Use this to read real files on disk (not the knowledge base).",
  parameters,
  execute,
  summarize: ({ path }) => path,
};
