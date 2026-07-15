import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editFileTool } from "@/app/tools/edit-file";
import { readFileTool } from "@/app/tools/read-file";
import { writeFileTool } from "@/app/tools/write-file";
import { resolveWithinCwd } from "@/app/tools/utils/workspace";

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "disk-tools-"));
  cwd = process.cwd();
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveWithinCwd", () => {
  it("resolves a path inside the working directory", () => {
    expect(resolveWithinCwd("a/b.txt", dir)).toBe(join(dir, "a/b.txt"));
  });

  it("rejects parent-directory escapes", () => {
    expect(() => resolveWithinCwd("../secret.txt", dir)).toThrow(/escapes the working directory/);
  });

  it("rejects absolute paths outside cwd", () => {
    expect(() => resolveWithinCwd("/etc/passwd", dir)).toThrow(/escapes the working directory/);
  });
});

describe("read_file", () => {
  it("reads a file and an optional line range", async () => {
    writeFileSync("note.txt", "one\ntwo\nthree");
    expect(await readFileTool.execute({ path: "note.txt", startLine: null, endLine: null })).toBe(
      "one\ntwo\nthree",
    );
    expect(await readFileTool.execute({ path: "note.txt", startLine: 2, endLine: 2 })).toBe("two");
  });

  it("returns a friendly message for a missing file", async () => {
    const out = await readFileTool.execute({ path: "missing.txt", startLine: null, endLine: null });
    expect(out).toMatch(/Could not read missing.txt/);
  });

  it("blocks reads outside the working directory", async () => {
    await expect(
      readFileTool.execute({ path: "../outside.txt", startLine: null, endLine: null }),
    ).rejects.toThrow(/escapes the working directory/);
  });
});

describe("write_file", () => {
  it("requires approval", () => {
    expect(writeFileTool.approvalPolicy?.({ path: "x.txt", content: "hi" })).toMatchObject({
      required: true,
    });
  });

  it("creates the file and parent directories", async () => {
    const out = await writeFileTool.execute({ path: "nested/x.txt", content: "hello" });
    expect(out).toMatch(/Wrote/);
    expect(readFileSync(join(dir, "nested/x.txt"), "utf8")).toBe("hello");
  });
});

describe("edit_file", () => {
  it("requires approval", () => {
    expect(
      editFileTool.approvalPolicy?.({ path: "x.txt", oldString: "a", newString: "b" }),
    ).toMatchObject({ required: true });
  });

  it("replaces a unique snippet", async () => {
    writeFileSync("code.ts", "const a = 1;\nconst b = 2;");
    const out = await editFileTool.execute({
      path: "code.ts",
      oldString: "const b = 2;",
      newString: "const b = 3;",
    });
    expect(out).toMatch(/Edited/);
    expect(readFileSync(join(dir, "code.ts"), "utf8")).toBe("const a = 1;\nconst b = 3;");
  });

  it("refuses when the snippet is not unique", async () => {
    writeFileSync("code.ts", "x\nx");
    const out = await editFileTool.execute({ path: "code.ts", oldString: "x", newString: "y" });
    expect(out).toMatch(/not unique/);
    // File is untouched.
    expect(readFileSync(join(dir, "code.ts"), "utf8")).toBe("x\nx");
  });

  it("reports when the snippet is absent", async () => {
    writeFileSync("code.ts", "abc");
    const out = await editFileTool.execute({ path: "code.ts", oldString: "zzz", newString: "y" });
    expect(out).toMatch(/not found/);
  });
});
