import React, { useState } from "react";
import { useInput } from "ink";
import { PickerModal, PromptModal } from "../components/picker-modal";
import { handlePickerKey, type PickerItem } from "../input/picker-keys";

export function PickerOverlay({
  title,
  subtitle,
  items,
  createLabel,
  plain,
  onResolve,
}: {
  title: string;
  subtitle?: string | undefined;
  items: readonly PickerItem[];
  createLabel: string;
  plain?: boolean;
  onResolve(value: string | "create" | null): void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onResolve(null);
      return;
    }

    const action = handlePickerKey(
      key.upArrow ? "\u001B[A" : key.downArrow ? "\u001B[B" : key.return ? "\r" : input,
      selected,
      items.length,
    );

    if (action === null) return;

    switch (action.type) {
      case "move":
        if (input >= "1" && input <= "9") {
          if (action.index < items.length) {
            const item = items[action.index];
            if (item) onResolve(item.id);
          } else {
            onResolve("create");
          }
          return;
        }
        setSelected(action.index);
        break;
      case "cancel":
        onResolve(null);
        break;
      case "confirm":
        if (selected < items.length) {
          const item = items[selected];
          if (item) onResolve(item.id);
        } else {
          onResolve("create");
        }
        break;
    }
  });

  return (
    <PickerModal
      title={title}
      subtitle={subtitle}
      items={items}
      createLabel={createLabel}
      selected={selected}
      {...(plain !== undefined ? { plain } : {})}
    />
  );
}

export function PromptOverlay({
  title,
  placeholder,
  onResolve,
}: {
  title: string;
  placeholder: string;
  onResolve(value: string | null): void;
}): React.JSX.Element {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onResolve(null);
      return;
    }
    if (key.return) {
      const trimmed = value.trim();
      onResolve(trimmed.length > 0 ? trimmed : null);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "c") {
      onResolve(null);
      return;
    }
    if (!key.ctrl && !key.meta && input.length === 1) {
      setValue((prev) => prev + input);
    }
  });

  return <PromptModal title={title} value={value} placeholder={placeholder} />;
}
