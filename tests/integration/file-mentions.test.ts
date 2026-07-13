import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFileMentions } from "../../src/integration/file-mentions";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "file-mentions-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveFileMentions", () => {
  it("replaces the @mention with the resolved path and inlines no contents", async () => {
    writeFileSync(join(dir, "note.txt"), "fixture body");

    const resolved = await resolveFileMentions("summarize @note.txt", dir);
    // The @ref is gone; a real path to note.txt is in its place.
    expect(resolved).not.toContain("@note.txt");
    expect(resolved).toMatch(/summarize \S*note\.txt$/);
    // No file body and no instructive note.
    expect(resolved).not.toContain("fixture body");
    expect(resolved).not.toContain("read_file");
  });

  it("leaves unknown paths unchanged", async () => {
    const text = "check @missing.txt";
    expect(await resolveFileMentions(text, dir)).toBe(text);
  });

  it("blocks cwd traversal", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(dir, "outside.txt"), "secret");

    expect(await resolveFileMentions("read @../outside.txt", root)).toBe("read @../outside.txt");
  });

  it("replaces every occurrence when a path is mentioned multiple times", async () => {
    writeFileSync(join(dir, "note.txt"), "once");

    const resolved = await resolveFileMentions("compare @note.txt and @note.txt", dir);
    expect(resolved).not.toContain("@note.txt");
    expect(resolved.match(/note\.txt/g)?.length).toBe(2);
  });

  it("blocks symlink escapes outside the cwd", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(dir, "outside.txt"), "secret");

    try {
      const { symlinkSync } = await import("node:fs");
      symlinkSync(join(dir, "outside.txt"), join(root, "link.txt"));
    } catch {
      // Skip when the environment cannot create symlinks.
      return;
    }

    expect(await resolveFileMentions("read @link.txt", root)).toBe("read @link.txt");
  });
});
