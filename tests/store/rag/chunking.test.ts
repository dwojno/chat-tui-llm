import { describe, expect, it } from "vitest";
import { chunkMarkdown, embedText } from "@/store/sources/rag/chunking";

const DOC = [
  "# Title", // 1
  "", // 2
  "## Section A", // 3
  "", // 4
  "Alpha one.", // 5
  "Alpha two.", // 6
  "", // 7
  "## Section B", // 8
  "", // 9
  "Beta content.", // 10
].join("\n");

describe("chunkMarkdown", () => {
  it("splits on headings and tracks breadcrumbs + line ranges", () => {
    const chunks = chunkMarkdown(DOC, { chunkTokens: 512, chunkOverlap: 64 });
    const paths = chunks.map((c) => c.headingPath);
    expect(paths).toContain("Title > Section A");
    expect(paths).toContain("Title > Section B");

    const sectionA = chunks.find((c) => c.headingPath === "Title > Section A");
    expect(sectionA).toBeDefined();
    expect(sectionA?.startLine).toBe(5);
    expect(sectionA?.endLine).toBe(6);
    expect(sectionA?.content).toContain("Alpha one.");
  });

  it("prepends the breadcrumb to the embedding text", () => {
    const [chunk] = chunkMarkdown("## Only\n\nBody here.", { chunkTokens: 512, chunkOverlap: 64 });
    expect(chunk).toBeDefined();
    expect(embedText(chunk!)).toBe("Only\n\nBody here.");
  });

  it("packs long sections into overlapping windows", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line number ${i} with some filler words`);
    const doc = `## Big\n\n${lines.join("\n")}`;
    const chunks = chunkMarkdown(doc, { chunkTokens: 40, chunkOverlap: 12 });

    expect(chunks.length).toBeGreaterThan(1);
    // line ranges are ascending and consecutive chunks overlap
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const curr = chunks[i]!;
      expect(curr.startLine).toBeLessThanOrEqual(prev.endLine);
      expect(curr.index).toBe(i);
    }
  });

  it("is deterministic", () => {
    const a = chunkMarkdown(DOC, { chunkTokens: 30, chunkOverlap: 8 });
    const b = chunkMarkdown(DOC, { chunkTokens: 30, chunkOverlap: 8 });
    expect(a).toEqual(b);
  });
});
