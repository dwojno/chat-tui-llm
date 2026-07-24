import React from "react";
import { Box, Text } from "ink";

export function Welcome(): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      marginBottom={1}
    >
      <Text color="magenta" bold>
        ✦ Welcome to Chat CLI ✦
      </Text>
      <Text dimColor>Type a message and press Enter to start chatting.</Text>
      <Text dimColor>
        Press <Text color="yellow">@</Text> to attach a file · <Text color="yellow">/</Text> for
        commands · <Text color="yellow">exit</Text> or Ctrl+C to quit.
      </Text>
    </Box>
  );
}
