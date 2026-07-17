import React from "react";
import { Box, Text } from "ink";
import Markdown from "../markdown";

const checkboxes = (content: string): string =>
  content.replace(/^(\s*)[-*+] \[[xX]\] /gm, "$1☑ ").replace(/^(\s*)[-*+] \[ \] /gm, "$1☐ ");

export function ScratchpadPanel({
  sections,
}: {
  sections: { section: string; content: string }[];
}): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
      {sections.map((s) => (
        <Box key={s.section} flexDirection="column">
          <Text color="cyan" bold>
            {s.section}
          </Text>
          <Markdown>{checkboxes(s.content)}</Markdown>
        </Box>
      ))}
    </Box>
  );
}
