import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const MENTION_RE = /(?:^|\s)@(?:"([^"]+)"|([\w./-]+))/g;

function formatResolvedPath(path: string): string {
  return path.includes(" ") ? `"${path}"` : path;
}

function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
    const path = match[1] ?? match[2];
    if (path && !seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }

  return paths;
}

export async function resolveFileMentions(text: string, cwd = process.cwd()): Promise<string> {
  const mentions = parseFileMentions(text);
  if (!mentions.length) return text;

  const root = resolve(cwd);
  const entries = await Promise.all(
    mentions.map(async (mention) => [mention, await resolveMentionFile(root, mention)] as const),
  );
  const resolved = new Map(entries.filter((entry): entry is [string, string] => entry[1] !== null));
  if (!resolved.size) return text;

  return text.replace(MENTION_RE, (match, quoted: string | undefined, bare: string | undefined) => {
    const mention = quoted ?? bare;
    if (!mention) return match;
    const full = resolved.get(mention);
    if (!full) return match;

    const lead = match.slice(0, match.indexOf("@"));
    return `${lead}${formatResolvedPath(full)}`;
  });
}
