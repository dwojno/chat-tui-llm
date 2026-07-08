import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types";
import Markdown from "../markdown";
import { MessageHeader } from "./message-header";
import { CollapsibleStepList } from "./step-list";

export function ChatMessage({ message }: { message: Message }): React.JSX.Element {
  const steps = message.role === "assistant" ? message.steps : undefined;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role={message.role} />
      <Box flexDirection="column" paddingLeft={2}>
        {steps && <CollapsibleStepList steps={steps} active={false} collapsed />}
        {message.role === "assistant" ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
}
