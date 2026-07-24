import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types";
import Markdown from "../markdown";
import { MessageHeader } from "./message-header";
import { CollapsibleStepList } from "./step-list";

export function contentWidth(): number {
  return Math.max(20, (process.stdout.columns ?? 80) - 6);
}

export function ChatMessage({
  message,
  dimmed = false,
}: {
  message: Message;
  dimmed?: boolean;
}): React.JSX.Element {
  const steps = message.role === "assistant" ? message.steps : undefined;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role={message.role} />
      <Box flexDirection="column" paddingLeft={2} marginTop={1} width={contentWidth()}>
        {steps && <CollapsibleStepList steps={steps} active={false} collapsed />}
        {message.role === "assistant" ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <Text dimColor={dimmed}>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
}
