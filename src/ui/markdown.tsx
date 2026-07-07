import React from "react";
import { Box, Text } from "ink";

/**
 * A small, dependency-free markdown renderer for the terminal.
 *
 * It covers the subset an assistant realistically emits — headings, bold /
 * italic / inline-code / strikethrough spans, fenced code blocks, ordered and
 * unordered lists, blockquotes, and horizontal rules — by mapping each
 * construct onto Ink components so styling composes with Ink's layout. Anything
 * it doesn't recognize falls through as plain text, so output is never worse
 * than the raw string.
 */

interface MarkdownProps {
  children: string;
}

// Inline spans, in precedence order. Code is matched first so markdown syntax
// inside `code` is left untouched.
const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*]+\*)|(_[^_]+_)/g;

/** Render a single line of text, resolving inline markdown spans. */
function renderInline(text: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    if (token.startsWith("`")) {
      nodes.push(
        <Text key={key++} color="yellow">
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <Text key={key++} bold>
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("~~")) {
      nodes.push(
        <Text key={key++} strikethrough>
          {token.slice(2, -2)}
        </Text>,
      );
    } else {
      // *italic* or _italic_
      nodes.push(
        <Text key={key++} italic>
          {token.slice(1, -1)}
        </Text>,
      );
    }

    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length ? nodes : text;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)\.\s+(.*)$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^\s*```/;

/** Split markdown into block-level Ink elements. */
function renderBlocks(source: string): React.ReactNode[] {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block — consume until the closing fence (or end of input).
    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      blocks.push(
        <Box key={key++} flexDirection="column" paddingX={1}>
          {code.map((codeLine, index) => (
            <Text key={index} color="gray">
              {codeLine || " "}
            </Text>
          ))}
        </Box>,
      );
      continue;
    }

    if (line.trim() === "") {
      blocks.push(<Text key={key++}> </Text>);
      continue;
    }

    if (RULE.test(line.trim())) {
      blocks.push(
        <Text key={key++} color="gray">
          ────────────
        </Text>,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push(
        <Text key={key++} bold color="cyan">
          {renderInline(heading[2])}
        </Text>,
      );
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote) {
      blocks.push(
        <Text key={key++} color="gray">
          {"│ "}
          {renderInline(quote[1])}
        </Text>,
      );
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      blocks.push(
        <Text key={key++}>
          {ordered[1]}
          {`${ordered[2]}. `}
          {renderInline(ordered[3])}
        </Text>,
      );
      continue;
    }

    const unordered = UNORDERED.exec(line);
    if (unordered) {
      blocks.push(
        <Text key={key++}>
          {unordered[1]}
          {"• "}
          {renderInline(unordered[2])}
        </Text>,
      );
      continue;
    }

    blocks.push(<Text key={key++}>{renderInline(line)}</Text>);
  }

  return blocks;
}

/** Render markdown text using Ink components. */
export default function Markdown({ children }: MarkdownProps): React.JSX.Element {
  return <Box flexDirection="column">{renderBlocks(children)}</Box>;
}
