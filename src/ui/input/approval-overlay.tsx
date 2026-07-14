import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ApprovalRequest } from "../../agent/humanLayer/approval";

const ALL_OPTIONS = [
  { id: "approve", label: "Approve", key: "a" },
  { id: "reject", label: "Reject", key: "r" },
  { id: "always", label: "Always allow this tool", key: "y" },
] as const;

const RISK_COLOR: Record<string, string> = { low: "green", medium: "yellow", high: "red" };

export function ApprovalOverlay({
  request,
  onResolve,
}: {
  request: ApprovalRequest;
  onResolve(value: string | null): void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const options = request.allowAlways === false ? ALL_OPTIONS.slice(0, 2) : ALL_OPTIONS;

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === "c")) return onResolve("reject");
    if (key.upArrow || input === "k") return setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow || input === "j")
      return setSelected((s) => Math.min(options.length - 1, s + 1));
    const byKey = options.find((o) => o.key === input);
    if (byKey) return onResolve(byKey.id);
    const digit = Number(input);
    if (Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      const opt = options[digit - 1];
      if (opt) onResolve(opt.id);
      return;
    }
    if (key.return) {
      const opt = options[selected];
      if (opt) onResolve(opt.id);
    }
  });

  const title = request.label ?? request.toolName;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text color="yellow" bold>
          {` Approve action? — ${title} `}
        </Text>
        {request.detail !== undefined && (
          <Box marginTop={1}>
            <Text>{request.detail}</Text>
          </Box>
        )}
        {request.reason !== undefined && (
          <Box marginTop={1}>
            <Text dimColor>{request.reason}</Text>
          </Box>
        )}
        {request.risk !== undefined && (
          <Box marginTop={1}>
            <Text color={RISK_COLOR[request.risk] ?? "yellow"}>risk: {request.risk}</Text>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {options.map((opt, index) => (
            <Text
              key={opt.id}
              {...(selected === index ? { color: "cyan", bold: true } : { dimColor: true })}
            >
              {selected === index ? "▸" : " "} {index + 1} {opt.label}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>
            j/k ↑↓ move · Enter confirm · a approve · r reject
            {request.allowAlways === false ? "" : " · y always"} · Esc reject
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
