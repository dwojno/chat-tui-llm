import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import Markdown from "../../src/ui/markdown";

/** Ink emits ANSI styling; assert on the visible text with those stripped. */
// eslint-disable-next-line no-control-regex
const strip = (frame: string | undefined): string => (frame ?? "").replace(/\[[0-9;]*m/g, "");

const frameOf = (markdown: string): string =>
  strip(render(<Markdown>{markdown}</Markdown>).lastFrame());

describe("Markdown", () => {
  it("renders headings, bold, and inline code as their text", () => {
    expect(frameOf("# Hello world")).toContain("Hello world");
    expect(frameOf("some **bold** here")).toContain("bold");
    expect(frameOf("call `render()` now")).toContain("render()");
  });

  it("renders unordered and ordered list markers", () => {
    expect(frameOf("- first item")).toContain("• first item");
    expect(frameOf("1. first step")).toContain("1. first step");
  });

  it("renders blockquotes with a gutter", () => {
    expect(frameOf("> a quote")).toContain("│ a quote");
  });

  it("renders fenced code blocks verbatim", () => {
    const frame = frameOf(["```", "const x = 1", "```"].join("\n"));
    expect(frame).toContain("const x = 1");
  });

  it("passes unrecognized text through unchanged", () => {
    expect(frameOf("just a plain sentence.")).toContain("just a plain sentence.");
  });
});
