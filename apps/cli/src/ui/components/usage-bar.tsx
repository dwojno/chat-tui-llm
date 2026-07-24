import React from "react";
import { Box, Text } from "ink";
import { formatUsageBar, type UsageSnapshot } from "@/session/usage";

export interface ChatContextBar {
  profileLabel: string;
  conversationLabel: string;
}

export function ContextBar({ context }: { context: ChatContextBar }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>Profile: {context.profileLabel}</Text>
      <Text dimColor>Conversation: {context.conversationLabel}</Text>
    </Box>
  );
}

export function UsageBar({
  usage,
  context,
}: {
  usage: UsageSnapshot;
  context?: ChatContextBar | undefined;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      {context !== undefined && <ContextBar context={context} />}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>{formatUsageBar(usage)}</Text>
      </Box>
    </Box>
  );
}
