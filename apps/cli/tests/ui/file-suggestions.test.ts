import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFileIndex,
  matchFileMentionToken,
  resetFileIndexCache,
  searchFiles,
} from "@/ui/file-suggestions";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "file-suggestions-"));
  resetFileIndexCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetFileIndexCache();
});

describe("matchFileMentionToken", () => {
  it("matches @query at the cursor", () => {
    expect(matchFileMentionToken("explain @src/rep", 16)).toEqual({
      query: "src/rep",
      start: 8,
    });
  });

  it("matches a bare @ at the cursor", () => {
    expect(matchFileMentionToken("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("returns null when the cursor is outside an @ token", () => {
    expect(matchFileMentionToken("hello world", 5)).toBeNull();
  });
});

describe("buildFileIndex", () => {
  it("collects files and skips ignored directories", () => {
    writeFileSync(join(dir, "visible.ts"), "export {}");
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "hidden.js"), "");
    mkdirSync(join(dir, ".hidden"), { recursive: true });
    writeFileSync(join(dir, ".hidden", "secret.ts"), "");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "");

    const index = buildFileIndex(dir);
    expect(index.files).toEqual(expect.arrayContaining(["visible.ts", "src/app.ts"]));
    expect(index.files).not.toContain("node_modules/hidden.js");
    expect(index.files).not.toContain(".hidden/secret.ts");
  });
});

describe("searchFiles", () => {
  const index = ["src/cli/repl.ts", "src/ui/chat.tsx", "package.json"];

  it("ranks exact basename matches first", () => {
    const results = searchFiles(index, "chat.tsx");
    expect(results[0]?.path).toBe("src/ui/chat.tsx");
  });

  it("returns shallow paths first for an empty query", () => {
    const results = searchFiles(index, "");
    expect(results[0]?.path).toBe("package.json");
  });

  it("limits results to five suggestions by default", () => {
    const big = Array.from({ length: 30 }, (_, i) => `file-${i}.ts`);
    expect(searchFiles(big, "")).toHaveLength(5);
  });

  it("pre-filters candidates before ranking", () => {
    writeFileSync(join(dir, "alpha.ts"), "");
    writeFileSync(join(dir, "beta.ts"), "");
    const built = buildFileIndex(dir);

    expect(searchFiles(built, "alpha")).toEqual([{ path: "alpha.ts", label: "alpha.ts" }]);
    expect(searchFiles(built, "missing")).toEqual([]);
  });
});
