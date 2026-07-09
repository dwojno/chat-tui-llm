import assert from "node:assert";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const MENTION_RE = /(?:^|\s)@([\w./-]+)/g;

const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024;

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function escapeXmlAttr(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function wrapFile(path: string, content: string): string {
  return `<file path="${escapeXmlAttr(path)}">\n${content}\n</file>`;
}

function decodeFileContent(buffer: Buffer): string {
  if (buffer.length <= MAX_FILE_BYTES) return buffer.toString("utf8");
  return `${buffer.subarray(0, MAX_FILE_BYTES).toString("utf8")}\n...[truncated]`;
}

async function resolveReadableFile(root: string, mentionPath: string): Promise<Buffer | null> {
  const canonical = await resolveMentionFile(root, mentionPath);
  if (!canonical) return null;

  try {
    return await readFile(canonical);
  } catch {
    return null;
  }
}

export async function resolveMentionFile(cwd: string, mentionPath: string): Promise<string | null> {
  const root = resolve(cwd);
  const absolute = resolve(root, mentionPath);
  if (!isWithinRoot(root, absolute)) return null;

  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch {
    return null;
  }

  let rootCanonical: string;
  try {
    rootCanonical = await realpath(root);
  } catch {
    return null;
  }

  if (!isWithinRoot(rootCanonical, canonical)) return null;

  try {
    const info = await stat(canonical);
    if (!info.isFile()) return null;
  } catch {
    return null;
  }

  return canonical;
}

export function parseFileMentions(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(MENTION_RE)) {
    const path = match[1];
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }

  return paths;
}

export async function expandFileMentions(text: string, cwd = process.cwd()): Promise<string> {
  const paths = parseFileMentions(text);
  if (!paths.length) return text;

  const root = resolve(cwd);
  const reads = await Promise.all(paths.map((path) => resolveReadableFile(root, path)));

  const blocks: string[] = [];
  let totalBytes = 0;
  let skipped = false;

  for (let i = 0; i < paths.length; i++) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      skipped = true;
      break;
    }

    const path = paths[i];
    assert(path !== undefined);
    const buffer = reads[i];
    if (!buffer || looksBinary(buffer)) continue;

    const content = decodeFileContent(buffer);
    const block = wrapFile(path, content);
    if (totalBytes + block.length > MAX_TOTAL_BYTES) {
      skipped = true;
      break;
    }

    blocks.push(block);
    totalBytes += block.length;
  }

  if (!blocks.length) return text;

  const prefix = blocks.join("\n\n");
  const suffix = skipped ? "\n\n[Some file attachments were omitted due to size limits.]" : "";
  return `${prefix}${suffix}\n\n${text}`;
}
