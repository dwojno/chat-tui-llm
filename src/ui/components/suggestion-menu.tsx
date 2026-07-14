import React from "react";
import { Box, Text } from "ink";
import { slashCommandCatalog, type SlashCommandInfo } from "../../commands/registry";
import { suggestFilesAtCursor, type FileSuggestion } from "../file-suggestions";

const SLASH_COMMANDS: SlashCommandInfo[] = slashCommandCatalog();

function matchSuggestions(value: string): SlashCommandInfo[] {
  if (!/^\/\S*$/.test(value)) return [];
  return SLASH_COMMANDS.filter((command) => command.completion.startsWith(value));
}

export function isExactSlashCommand(value: string): boolean {
  return SLASH_COMMANDS.some((command) => command.completion === value);
}

export type ActiveSuggestions =
  | { kind: "slash"; items: SlashCommandInfo[] }
  | { kind: "file"; items: FileSuggestion[] };

export function activeSuggestions(value: string, cursor: number): ActiveSuggestions | null {
  const slash = matchSuggestions(value);
  if (slash.length) return { kind: "slash", items: slash };
  const files = suggestFilesAtCursor(value, cursor);
  if (files.length) return { kind: "file", items: files };
  return null;
}

export function SuggestionMenu({
  suggestions,
  selected,
}: {
  suggestions: ActiveSuggestions;
  selected: number;
}): React.JSX.Element {
  const sel = Math.min(selected, suggestions.items.length - 1);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {suggestions.kind === "slash"
        ? suggestions.items.map((command, i) => (
            <Text key={command.completion} color={i === sel ? "cyan" : "gray"}>
              {i === sel ? "❯ " : "  "}
              <Text bold={i === sel}>{command.completion.trim()}</Text>
              <Text dimColor> — {command.hint}</Text>
            </Text>
          ))
        : suggestions.items.map((file, i) => (
            <Text key={file.path} color={i === sel ? "cyan" : "gray"}>
              {i === sel ? "❯ " : "  "}
              <Text bold={i === sel}>{file.label}</Text>
            </Text>
          ))}
      <Text dimColor>{"  "}↑↓ to select · Tab/Enter to complete</Text>
    </Box>
  );
}
