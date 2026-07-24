import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editFileTool } from "@chat/tools/edit-file";
import { readFileTool } from "@chat/tools/read-file";
import { writeFileTool } from "@chat/tools/write-file";
import { resolveWithinCwd } from "@chat/tools/utils/workspace";

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

  it("rejects a deep traversal to a system path", () => {
    expect(() => resolveWithinCwd("../../../../../../etc/passwd", dir)).toThrow(
      /escapes the working directory/,
    );
  });

  it("rejects traversal that only escapes after normalization", () => {
    expect(() => resolveWithinCwd("a/b/../../../secret.txt", dir)).toThrow(
      /escapes the working directory/,
    );
  });

  it("rejects the working directory itself", () => {
    expect(() => resolveWithinCwd(".", dir)).toThrow(/escapes the working directory/);
  });

  it("does not decode percent-encoded traversal — it stays a literal filename inside cwd", () => {
    expect(resolveWithinCwd("%2e%2e%2f%2e%2e%2fsecret.txt", dir)).toBe(
      join(dir, "%2e%2e%2f%2e%2e%2fsecret.txt"),
    );
  });

  it("conservatively rejects a name beginning with .. (backslash traversal, no escape either way)", () => {
    expect(() => resolveWithinCwd("..\\..\\secret.txt", dir)).toThrow(
      /escapes the working directory/,
    );
  });
});

describe("overwrite defense (binary + escaping payloads)", () => {
  it("cannot overwrite a file outside cwd via an escaping path, even with binary content", async () => {
    const sentinel = join(dir, "..", "sentinel.txt");
    writeFileSync(sentinel, "original");
    const binary = "\x00\x01\xff\x1b[2Jpwned";

    await expect(
      writeFileTool.execute({ path: "../sentinel.txt", content: binary }),
    ).rejects.toThrow(/escapes the working directory/);

    expect(readFileSync(sentinel, "utf8")).toBe("original");
    rmSync(sentinel, { force: true });
  });

  it("writes binary/control-byte content only inside cwd", async () => {
    const binary = "\x00\x01\x02\x1b[31mred\xff";
    const out = await writeFileTool.execute({ path: "blob.bin", content: binary });
    expect(out).toMatch(/Wrote/);
    expect(readFileSync(join(dir, "blob.bin"), "utf8")).toBe(binary);
  });

  it("rejects a null-byte path without writing anything", async () => {
    const out = await writeFileTool.execute({ path: "evil\x00.txt", content: "x" });
    expect(out).toMatch(/Could not write/);
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

  it("reads hex/binary bytes as lossy utf8 without throwing", async () => {
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x1b, 0x5b, 0x32, 0x4a, 0xc0, 0x80]);
    writeFileSync("blob.bin", bytes);
    const out = await readFileTool.execute({ path: "blob.bin", startLine: null, endLine: null });
    expect(typeof out).toBe("string");
  });

  it("caps a huge file instead of loading it whole", async () => {
    writeFileSync("huge.txt", "A".repeat(2 * 1024 * 1024));
    const out = await readFileTool.execute({ path: "huge.txt", startLine: null, endLine: null });
    expect(out).toMatch(/\[truncated: file exceeds \d+ bytes\]/);
    expect(out.length).toBeLessThan(300 * 1024);
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

    expect(readFileSync(join(dir, "code.ts"), "utf8")).toBe("x\nx");
  });

  it("reports when the snippet is absent", async () => {
    writeFileSync("code.ts", "abc");
    const out = await editFileTool.execute({ path: "code.ts", oldString: "zzz", newString: "y" });
    expect(out).toMatch(/not found/);
  });
});
