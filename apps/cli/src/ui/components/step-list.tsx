import React from "react";
import { Box, Text } from "ink";
import { buildStepDisplay, summarizeSteps } from "../group-steps";
import type { Step } from "../types";
import { Spinner } from "./spinner";

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function stepText(step: Step, nested: boolean): string {
  const detail = step.detail ? ` — ${truncate(step.detail, 48)}` : "";
  const tag = !nested && step.fork ? ` · ${truncate(step.fork, 32)}` : "";
  return `${step.label}${detail}${tag}`;
}

function StepRow({
  step,
  active,
  indent,
  nested,
}: {
  step: Step;
  active: boolean;
  indent: number;
  nested: boolean;
}): React.JSX.Element {
  return (
    <Box paddingLeft={indent}>
      {active ? (
        <Spinner label={stepText(step, nested)} color="green" />
      ) : (
        <Text dimColor>✓ {stepText(step, nested)}</Text>
      )}
    </Box>
  );
}

export function CollapsibleStepList({
  steps,
  active,
  collapsed,
}: {
  steps: Step[];
  active: boolean;
  collapsed: boolean;
}): React.JSX.Element | null {
  if (steps.length === 0) return null;

  if (collapsed) {
    return (
      <Box marginBottom={1}>
        <Text dimColor>▸ {summarizeSteps(steps)}</Text>
      </Box>
    );
  }

  return <StepList steps={steps} active={active} />;
}

function StepList({ steps, active }: { steps: Step[]; active: boolean }): React.JSX.Element | null {
  if (steps.length === 0) return null;

  const display = buildStepDisplay(steps);
  const lastFlatIndex = steps.length - 1;

  return (
    <Box flexDirection="column">
      {display.map((item) => {
        if (item.type === "solo") {
          return (
            <StepRow
              key={item.flatIndex}
              step={item.step}
              active={active && item.flatIndex === lastFlatIndex}
              indent={0}
              nested={false}
            />
          );
        }

        return (
          <Box key={item.parentFlatIndex} flexDirection="column">
            <StepRow
              step={item.parent}
              active={active && item.parentFlatIndex === lastFlatIndex}
              indent={0}
              nested={false}
            />
            {item.children.map(({ step, flatIndex }) => (
              <StepRow
                key={flatIndex}
                step={step}
                active={active && flatIndex === lastFlatIndex}
                indent={2}
                nested
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
