import React from "react";
import { Box, Text } from "ink";
import type { Step } from "../types";
import { Spinner } from "./spinner";

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function stepText(step: Step): string {
  const detail = step.detail ? ` — ${truncate(step.detail, 48)}` : "";
  const tag = step.fork ? ` · ${truncate(step.fork, 32)}` : "";
  return `${step.label}${detail}${tag}`;
}

function StepRow({ step, active }: { step: Step; active: boolean }): React.JSX.Element {
  return (
    <Box paddingLeft={step.fork ? 2 : 0}>
      {active ? (
        <Spinner label={stepText(step)} color="green" />
      ) : (
        <Text dimColor>✓ {stepText(step)}</Text>
      )}
    </Box>
  );
}

export function StepList({
  steps,
  active,
}: {
  steps: Step[];
  active: boolean;
}): React.JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <Box flexDirection="column">
      {steps.map((step, index) => (
        <StepRow key={index} step={step} active={active} />
      ))}
    </Box>
  );
}
