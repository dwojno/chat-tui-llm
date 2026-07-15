import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { toMarkdown } from "@/store/sources/rag/markdown";

const buf = (s: string): Buffer => Buffer.from(s, "utf8");

describe("toMarkdown", () => {
  it("passes Markdown through", async () => {
    expect(await toMarkdown("a.md", buf("# Hi\n\nBody"))).toBe("# Hi\n\nBody");
  });

  it("fences source code with a language hint", async () => {
    expect(await toMarkdown("a.ts", buf("const x = 1"))).toBe("```typescript\nconst x = 1\n```");
  });

  it("returns plain text as-is", async () => {
    expect(await toMarkdown("notes.txt", buf("just text"))).toBe("just text");
  });

  it("converts HTML to Markdown", async () => {
    const md = await toMarkdown("a.html", buf("<h1>Title</h1><p>Body text</p>"));
    expect(md).toContain("# Title");
    expect(md).toContain("Body text");
  });

  it("converts CSV to a Markdown table", async () => {
    const md = await toMarkdown("data.csv", buf("name,age\nAlice,30\nBob,25"));
    expect(md).toContain("| name | age |");
    expect(md).toContain("| Alice | 30 |");
    expect(md).toContain("| Bob | 25 |");
  });

  it("converts XLSX sheets to Markdown tables with headings", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["city", "pop"],
      ["Paris", 2],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Cities");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const md = await toMarkdown("book.xlsx", bytes);
    expect(md).toContain("## Cities");
    expect(md).toContain("| city | pop |");
    expect(md).toContain("| Paris | 2 |");
  });

  it("rejects binary files of unknown type", async () => {
    await expect(toMarkdown("blob.bin", Buffer.from([0, 1, 2, 0, 5]))).rejects.toThrow(
      /Unsupported binary/,
    );
  });
});
