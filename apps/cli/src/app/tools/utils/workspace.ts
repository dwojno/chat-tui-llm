import assert from "node:assert";
import { isAbsolute, relative, resolve } from "node:path";

export function resolveWithinCwd(path: string, cwd: string = process.cwd()): string {
  const root = resolve(cwd);
  const target = resolve(root, path);
  const rel = relative(root, target);
  assert(
    rel !== "" && !rel.startsWith("..") && !isAbsolute(rel),
    `Path escapes the working directory: ${path}`,
  );
  return target;
}
