import assert from "node:assert";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

export interface FileSuggestion {
  path: string;
  label: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".chat-state"]);
const MAX_INDEX_FILES = 10_000;
const SHALLOW_DEPTH = 2;
const SUGGESTION_LIMIT = 5;

interface FileIndex {
  files: string[];
  shallow: string[];
}

let cachedRoot: string | null = null;
let cachedIndex: FileIndex | null = null;

function shouldSkipDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIRS.has(name);
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function toPosixPath(root: string, full: string): string {
  return relative(root, full).split("\\").join("/");
}

export function buildFileIndex(root: string): FileIndex {
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= MAX_INDEX_FILES) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_INDEX_FILES) return;

      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) walk(full);
      } else if (entry.isFile()) {
        files.push(toPosixPath(root, full));
      }
    }
  }

  walk(root);
  const shallow = files
    .filter((path) => pathDepth(path) <= SHALLOW_DEPTH)
    .toSorted((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));

  return { files, shallow };
}

function getFileIndex(root: string): FileIndex {
  if (cachedRoot !== root || cachedIndex === null) {
    cachedRoot = root;
    cachedIndex = buildFileIndex(root);
  }
  return cachedIndex;
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function scoreMatch(path: string, query: string): number {
  const lowerPath = path.toLowerCase();
  const lowerBase = basename(path).toLowerCase();
  const q = query.toLowerCase();

  if (!q) return pathDepth(path);

  if (lowerBase === q) return 0;
  if (lowerBase.startsWith(q)) return 1;
  if (lowerPath.startsWith(q)) return 2;
  if (lowerBase.includes(q)) return 3;
  if (lowerPath.includes(q)) return 4;
  return -1;
}

export function searchFiles(index: FileIndex, query: string, limit?: number): FileSuggestion[];
export function searchFiles(
  index: readonly string[],
  query: string,
  limit?: number,
): FileSuggestion[];
export function searchFiles(
  index: FileIndex | readonly string[],
  query: string,
  limit = SUGGESTION_LIMIT,
): FileSuggestion[] {
  const files = "files" in index ? index.files : index;
  const shallow = "files" in index ? index.shallow : null;
  const q = query.toLowerCase();

  const candidates = q
    ? files.filter((path: string) => path.toLowerCase().includes(q))
    : (shallow ?? files.filter((path: string) => pathDepth(path) <= SHALLOW_DEPTH));

  const ranked = candidates
    .map((path: string) => ({ path, score: scoreMatch(path, query) }))
    .filter((entry) => entry.score >= 0)
    .toSorted(
      (a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path),
    )
    .slice(0, limit);

  return ranked.map(({ path }) => ({ path, label: path }));
}

export function matchFileMentionToken(
  value: string,
  cursor: number,
): { query: string; start: number } | null {
  const before = value.slice(0, cursor);
  const match = before.match(/@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  const query = match[1];
  assert(query !== undefined);
  return { query, start: match.index };
}

export function suggestFilesAtCursor(
  value: string,
  cursor: number,
  root = process.cwd(),
): FileSuggestion[] {
  const token = matchFileMentionToken(value, cursor);
  if (!token) return [];
  return searchFiles(getFileIndex(root), token.query);
}

export function resetFileIndexCache(): void {
  cachedRoot = null;
  cachedIndex = null;
}
