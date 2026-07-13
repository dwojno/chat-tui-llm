import React from "react";
import { Box, Text } from "ink";
import type { PickerItem } from "../input/picker-keys";

const CONTENT_WIDTH = 52;

function pad(label: string, width: number): string {
  return label.length >= width ? label.slice(0, width) : label.padEnd(width);
}

function PickerRow({
  number,
  item,
  selected,
  createLabel,
  isCreate,
  plain,
}: {
  number: string;
  item?: PickerItem | undefined;
  selected: boolean;
  createLabel?: string | undefined;
  isCreate: boolean;
  plain: boolean;
}): React.JSX.Element {
  const prefix = selected ? "▸" : " ";

  if (isCreate) {
    const label = `+  n  ${createLabel ?? "Create new"}`;
    return (
      <Text {...(selected ? { color: "cyan", bold: true } : { dimColor: true })}>
        {prefix} {label}
      </Text>
    );
  }

  if (plain) {
    return (
      <Text {...(selected ? { color: "cyan", bold: true } : { dimColor: true })}>
        {prefix} {number} {item?.label ?? ""}
      </Text>
    );
  }

  const meta = item?.meta ? pad(item.meta, 16) : "".padEnd(16);
  const marker = item?.current ? " *" : "  ";
  const label = pad(item?.label ?? "", CONTENT_WIDTH - 20);

  return (
    <Text {...(selected ? { color: "cyan", bold: true } : { dimColor: true })}>
      {prefix} {number} {label} {meta}
      {marker}
    </Text>
  );
}

export function PickerModal({
  title,
  subtitle,
  items,
  createLabel,
  selected,
  plain = false,
}: {
  title: string;
  subtitle?: string | undefined;
  items: readonly PickerItem[];
  createLabel: string;
  selected: number;
  plain?: boolean;
}): React.JSX.Element {
  const heading = subtitle ? `${title} — ${subtitle}` : title;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="cyan" bold>
          {` ${heading} `}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, index) => (
            <PickerRow
              key={item.id}
              number={String(index + 1)}
              item={item}
              selected={selected === index}
              isCreate={false}
              plain={plain}
            />
          ))}
          <PickerRow
            number=""
            selected={selected === items.length}
            createLabel={createLabel}
            isCreate
            plain={plain}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>j/k ↑↓ move · Enter confirm · 1-9 jump · n create · Esc close</Text>
        </Box>
      </Box>
    </Box>
  );
}

export function PromptModal({
  title,
  value,
  placeholder,
}: {
  title: string;
  value: string;
  placeholder: string;
}): React.JSX.Element {
  const display = value.length > 0 ? value : placeholder;
  const dim = value.length === 0;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="cyan" bold>
          {` ${title} `}
        </Text>
        <Box marginTop={1}>
          <Text color="cyan">{"> "}</Text>
          <Text color={dim ? "gray" : "white"} dimColor={dim}>
            {display}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Enter confirm · Esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
