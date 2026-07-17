import React from "react";
import { Text } from "ink";
import { marked, type MarkedOptions } from "marked";
import TerminalRenderer from "marked-terminal";

interface MarkdownProps {
  children: string;
}

export default function Markdown({ children }: MarkdownProps): React.JSX.Element {
  const renderer = new TerminalRenderer({
    reflowText: false,
    width: 1_000_000,
    showSectionPrefix: false,
    tab: 2,
  }) as unknown as MarkedOptions["renderer"];
  marked.setOptions({ renderer });
  const rendered = marked.parse(children, { async: false }) as string;
  return <Text>{rendered.trimEnd()}</Text>;
}
