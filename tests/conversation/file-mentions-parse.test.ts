import { describe, expect, it } from "vitest";
import { parseFileMentions } from "../../src/conversation/file-mentions";

describe("parseFileMentions", () => {
  it("extracts unique @paths from a line", () => {
    expect(parseFileMentions("/learn @src/a.ts @src/b.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(parseFileMentions("compare @src/a.ts and @src/a.ts")).toEqual(["src/a.ts"]);
  });
});
