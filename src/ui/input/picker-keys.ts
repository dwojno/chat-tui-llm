export type PickerItem = {
  id: string;
  label: string;
  meta?: string | undefined;
  current?: boolean | undefined;
};

export type PickerKeyAction =
  | { type: "move"; index: number }
  | { type: "confirm" }
  | { type: "cancel" };

export function pickerRowCount(itemCount: number): number {
  return itemCount + 1;
}

export function handlePickerKey(
  input: string,
  selected: number,
  itemCount: number,
): PickerKeyAction | null {
  const rows = pickerRowCount(itemCount);
  const createIndex = itemCount;

  if (input === "k" || input === "\u001B[A") {
    return { type: "move", index: Math.max(0, selected - 1) };
  }
  if (input === "j" || input === "\u001B[B") {
    return { type: "move", index: Math.min(rows - 1, selected + 1) };
  }
  if (input === "\r" || input === "\n") {
    return { type: "confirm" };
  }
  if (input === "\u001B" || input === "\u001B\u001B") {
    return { type: "cancel" };
  }
  if (input === "n") {
    return { type: "move", index: createIndex };
  }
  const digit = Number(input);
  if (digit >= 1 && digit <= 9 && digit <= itemCount) {
    return { type: "move", index: digit - 1 };
  }
  return null;
}
