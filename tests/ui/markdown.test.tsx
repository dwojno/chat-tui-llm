import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import Markdown from "@/ui/markdown";

const strip = (frame: string | undefined): string => (frame ?? "").replace(/\[[0-9;]*m/g, "");

const frameOf = (markdown: string): string =>
  strip(render(<Markdown>{markdown}</Markdown>).lastFrame());

describe("Markdown", () => {
  it("renders headings without the leading hashes", () => {
    const frame = frameOf("# Hello world");
    expect(frame).toContain("Hello world");
    expect(frame).not.toContain("#");
  });

  it("renders bold and inline code as their text", () => {
    expect(frameOf("some **bold** here")).toContain("bold");
    expect(frameOf("call `render()` now")).toContain("render()");
  });

  it("renders unordered and ordered lists", () => {
    expect(frameOf("- first item")).toContain("first item");
    expect(frameOf("1. first step")).toContain("1. first step");
  });

  it("renders blockquote text", () => {
    expect(frameOf("> a quote")).toContain("a quote");
  });

  it("renders fenced code blocks verbatim", () => {
    expect(frameOf(["```", "const x = 1", "```"].join("\n"))).toContain("const x = 1");
  });

  it("passes plain text through unchanged", () => {
    expect(frameOf("just a plain sentence.")).toContain("just a plain sentence.");
  });
});
