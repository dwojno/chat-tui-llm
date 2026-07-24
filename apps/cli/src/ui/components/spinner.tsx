import React from "react";
import { Text, type TextProps } from "ink";
import { useAnimationFrame } from "../hooks/use-animation-frame";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({
  label,
  color,
}: {
  label: string;
  color: NonNullable<TextProps["color"]>;
}): React.JSX.Element {
  const frame = useAnimationFrame(SPINNER_FRAMES.length, 80);
  return (
    <Text color={color}>
      {SPINNER_FRAMES[frame]} <Text dimColor>{label}</Text>
    </Text>
  );
}

export function Cursor({ color }: { color: NonNullable<TextProps["color"]> }): React.JSX.Element {
  const frame = useAnimationFrame(2, 450);
  return <Text color={color}>{frame === 0 ? "▋" : " "}</Text>;
}
