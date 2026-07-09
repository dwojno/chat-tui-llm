import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { matchFileMentionToken, type FileSuggestion } from "../file-suggestions";
import type { SlashCommandInfo } from "../../integration/commands/registry";
import {
  activeSuggestions,
  isExactSlashCommand,
  SuggestionMenu,
} from "../components/suggestion-menu";

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);

function hasControlChar(input: string): boolean {
  return [...input].some((ch) => ch.charCodeAt(0) < 0x20);
}

interface PromptInputProps {
  active: boolean;
  onSubmit(line: string): void;
  onExit(): void;
}

export function PromptInput({
  active,
  onSubmit,
  onExit,
}: PromptInputProps): React.JSX.Element | null {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);

  const suggestions = useMemo(
    () => (active ? activeSuggestions(value, cursor) : null),
    [active, value, cursor],
  );
  const menuOpen = suggestions !== null;
  const sel = menuOpen ? Math.min(selected, suggestions.items.length - 1) : 0;

  const acceptSlash = (command: SlashCommandInfo): void => {
    setValue(command.completion);
    setCursor(command.completion.length);
    setSelected(0);
  };

  const acceptFile = (file: FileSuggestion): void => {
    const token = matchFileMentionToken(value, cursor);
    if (!token) return;
    const insertion = `@${file.path} `;
    const next = value.slice(0, token.start) + insertion + value.slice(cursor);
    setValue(next);
    setCursor(token.start + insertion.length);
    setSelected(0);
  };

  const acceptHighlighted = (): void => {
    if (!suggestions) return;
    if (suggestions.kind === "slash") {
      const item = suggestions.items[sel];
      if (item) acceptSlash(item);
    } else {
      const item = suggestions.items[sel];
      if (item) acceptFile(item);
    }
  };

  useInput((input, key) => {
    const ctrlC = (key.ctrl && input === "c") || input === CTRL_C;
    const ctrlD = (key.ctrl && input === "d") || input === CTRL_D;
    if (ctrlC) return onExit();
    if (ctrlD && value === "") return onExit();
    if (!active) return;

    if (key.upArrow) {
      if (menuOpen && suggestions) {
        setSelected((s) => (s - 1 + suggestions.items.length) % suggestions.items.length);
      }
      return;
    }
    if (key.downArrow) {
      if (menuOpen && suggestions) {
        setSelected((s) => (s + 1) % suggestions.items.length);
      }
      return;
    }
    if (key.tab) {
      if (menuOpen) acceptHighlighted();
      return;
    }
    if (key.return) {
      if (menuOpen && !(suggestions?.kind === "slash" && isExactSlashCommand(value))) {
        acceptHighlighted();
        return;
      }
      const line = value;
      setValue("");
      setCursor(0);
      setSelected(0);
      onSubmit(line);
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (key.ctrl && input === "a") {
      setCursor(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursor(value.length);
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor((c) => c - 1);
        setSelected(0);
      }
      return;
    }
    if (input && !key.ctrl && !key.meta && !hasControlChar(input)) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor((c) => c + input.length);
      setSelected(0);
    }
  });

  if (!active) return null;

  const before = value.slice(0, cursor);
  const atCursor = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          {"❯ "}
        </Text>
        <Text>{before}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{after}</Text>
      </Box>
      {menuOpen && suggestions && <SuggestionMenu suggestions={suggestions} selected={sel} />}
    </Box>
  );
}
