import { describe, expect, it } from "vitest";
import { parseFileMentions } from "@/app/input/file-mentions";

describe("parseFileMentions", () => {
  it("extracts unique @paths from a line", () => {
    expect(parseFileMentions("/learn @src/a.ts @src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseFileMentions("compare @src/a.ts and @src/a.ts")).toEqual(["src/a.ts"]);
  });

  it("extracts quoted paths that contain spaces", () => {
    expect(parseFileMentions('read @"my notes.txt"')).toEqual(["my notes.txt"]);
    expect(parseFileMentions('compare @"a b.ts" and @src/c.ts')).toEqual(["a b.ts", "src/c.ts"]);
  });
});
