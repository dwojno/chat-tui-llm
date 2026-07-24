import assert from "node:assert";
import { estimateTokens } from "@/app/tokens";

export interface Chunk {
  index: number;
  headingPath: string;
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
}

export interface ChunkOptions {
  chunkTokens: number;
  chunkOverlap: number;
}

interface NumberedLine {
  n: number;
  text: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

export function chunkMarkdown(markdown: string, opts: ChunkOptions): Chunk[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: Chunk[] = [];

  let stack: { level: number; title: string }[] = [];
  let block: NumberedLine[] = [];
  let blockPath = "";

  const breadcrumb = (): string => stack.map((s) => s.title).join(" > ");
  const flush = (): void => {
    packBlock(block, blockPath, opts, out);
    block = [];
  };

  lines.forEach((text, i) => {
    const match = HEADING.exec(text);
    if (match) {
      flush();
      const hashes = match[1];
      const title = match[2];
      assert(hashes !== undefined && title !== undefined);
      const level = hashes.length;
      stack = stack.filter((s) => s.level < level);
      stack.push({ level, title: title.trim() });
      blockPath = breadcrumb();
    } else {
      block.push({ n: i + 1, text });
    }
  });
  flush();

  return out;
}

function lineTokens(line: NumberedLine): number {
  return estimateTokens(line.text) + 1;
}

export function embedText(chunk: Chunk): string {
  return chunk.headingPath ? `${chunk.headingPath}\n\n${chunk.content}` : chunk.content;
}

function packBlock(
  block: NumberedLine[],
  headingPath: string,
  opts: ChunkOptions,
  out: Chunk[],
): void {
  const lines = trimBlank(block);
  if (!lines.length) return;

  let current: NumberedLine[] = [];
  let tokens = 0;

  const emit = (): void => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    assert(first !== undefined && last !== undefined);
    const content = current
      .map((line) => line.text)
      .join("\n")
      .trim();
    if (content) {
      out.push({
        index: out.length,
        headingPath,
        content,
        startLine: first.n,
        endLine: last.n,
        tokenCount: estimateTokens(content),
      });
    }
    current = [];
    tokens = 0;
  };

  for (const line of lines) {
    const t = lineTokens(line);
    if (tokens + t > opts.chunkTokens && current.length) {
      const overlap = takeOverlap(current, opts.chunkOverlap);
      emit();
      current = [...overlap];
      tokens = overlap.reduce((sum, l) => sum + lineTokens(l), 0);
    }
    current.push(line);
    tokens += t;
  }
  emit();
}

function takeOverlap(lines: NumberedLine[], overlapTokens: number): NumberedLine[] {
  if (overlapTokens <= 0) return [];
  const kept: NumberedLine[] = [];
  let tokens = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    assert(line !== undefined);
    const t = lineTokens(line);
    if (tokens + t > overlapTokens && kept.length) break;
    kept.unshift(line);
    tokens += t;
  }
  return kept;
}

function trimBlank(lines: NumberedLine[]): NumberedLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start]?.text.trim() ?? "") === "") start++;
  while (end > start && (lines[end - 1]?.text.trim() ?? "") === "") end--;
  return lines.slice(start, end);
}
