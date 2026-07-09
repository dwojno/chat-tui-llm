import React from "react";
import { Box, Text } from "ink";

interface MarkdownProps {
  children: string;
}

const INLINE_PATTERN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(~~[^~]+~~)|(\*[^*]+\*)|(_[^_]+_)/g;

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

function renderBlocks(source: string): React.ReactNode[] {
  const lines = source.split("\n");
  const blocks: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (FENCE.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const codeLine = lines[i];
        if (codeLine === undefined || FENCE.test(codeLine)) break;
        code.push(codeLine);
        i++;
      }
      blocks.push(
        <Box key={key++} flexDirection="column" paddingX={1}>
          {code.map((codeLine, index) => (
            <Text key={codeLine ?? index} color="gray">
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
          {renderInline(heading[2] ?? "")}
        </Text>,
      );
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote) {
      blocks.push(
        <Text key={key++} color="gray">
          {"│ "}
          {renderInline(quote[1] ?? "")}
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
          {renderInline(ordered[3] ?? "")}
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
          {renderInline(unordered[2] ?? "")}
        </Text>,
      );
      continue;
    }

    blocks.push(<Text key={key++}>{renderInline(line)}</Text>);
  }

  return blocks;
}

export default function Markdown({ children }: MarkdownProps): React.JSX.Element {
  return <Box flexDirection="column">{renderBlocks(children)}</Box>;
}
