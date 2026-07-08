import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandFileMentions } from "../../src/conversation/file-mentions";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "file-mentions-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("expandFileMentions", () => {
  it("wraps readable files in <file> blocks before the user text", async () => {
    writeFileSync(join(dir, "note.txt"), "fixture body");

    const expanded = await expandFileMentions("summarize @note.txt", dir);
    expect(expanded).toContain('<file path="note.txt">');
    expect(expanded).toContain("fixture body");
    expect(expanded.endsWith("summarize @note.txt")).toBe(true);
  });

  it("leaves unknown paths unchanged", async () => {
    const text = "check @missing.txt";
    expect(await expandFileMentions(text, dir)).toBe(text);
  });

  it("blocks cwd traversal", async () => {
    const root = join(dir, "proj");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(dir, "outside.txt"), "secret");

    const expanded = await expandFileMentions("read @../outside.txt", root);
    expect(expanded).toBe("read @../outside.txt");
  });

  it("truncates very large files", async () => {
    writeFileSync(join(dir, "big.txt"), "x".repeat(40_000));

    const expanded = await expandFileMentions("read @big.txt", dir);
    expect(expanded).toContain("...[truncated]");
  });

  it("skips binary files", async () => {
    writeFileSync(join(dir, "binary.bin"), Buffer.from([0, 1, 2, 0]));

    const text = "inspect @binary.bin";
    expect(await expandFileMentions(text, dir)).toBe(text);
  });

  it("reads each unique path only once when mentioned multiple times", async () => {
    writeFileSync(join(dir, "note.txt"), "once");

    const expanded = await expandFileMentions("compare @note.txt and @note.txt", dir);
    expect(expanded.match(/<file path="note.txt">/g)).toHaveLength(1);
    expect(expanded).toContain("once");
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

    const expanded = await expandFileMentions("read @link.txt", root);
    expect(expanded).toBe("read @link.txt");
  });
});
