import React from "react";
import { Box } from "ink";
import { ROLE_META, type Step } from "../types";
import Markdown from "../markdown";
import { MessageHeader } from "./message-header";
import { CollapsibleStepList } from "./step-list";
import { Cursor, Spinner } from "./spinner";

export function StreamingMessage({
  steps,
  content,
}: {
  steps: Step[];
  content: string;
}): React.JSX.Element {
  const { color } = ROLE_META.assistant;
  const answering = content !== "";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role="assistant" />
      <Box flexDirection="column" paddingLeft={2}>
        <CollapsibleStepList steps={steps} active={!answering} collapsed={answering} />
        {answering ? (
          <Box>
            <Markdown>{content}</Markdown>
            <Cursor color={color} />
          </Box>
        ) : steps.length === 0 ? (
          <Spinner label="thinking…" color={color} />
        ) : null}
      </Box>
    </Box>
  );
}
