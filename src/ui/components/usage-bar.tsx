import React from "react";
import { Box, Text } from "ink";
import { formatUsageBar, type UsageSnapshot } from "../../integration/usage";

export function UsageBar({ usage }: { usage: UsageSnapshot }): React.JSX.Element {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text dimColor>{formatUsageBar(usage)}</Text>
    </Box>
  );
}
