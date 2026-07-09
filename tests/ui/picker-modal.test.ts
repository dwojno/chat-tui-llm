import { describe, expect, it } from "vitest";
import { handlePickerKey, pickerRowCount } from "../../src/ui/input/picker-keys";

describe("handlePickerKey", () => {
  const items = 3;

  it("moves down with j", () => {
    expect(handlePickerKey("j", 0, items)).toEqual({ type: "move", index: 1 });
  });

  it("moves up with k", () => {
    expect(handlePickerKey("k", 2, items)).toEqual({ type: "move", index: 1 });
  });

  it("jumps to numbered item", () => {
    expect(handlePickerKey("2", 0, items)).toEqual({ type: "move", index: 1 });
  });

  it("jumps to create row with n", () => {
    expect(handlePickerKey("n", 0, items)).toEqual({ type: "move", index: items });
  });

  it("confirms on enter", () => {
    expect(handlePickerKey("\r", 0, items)).toEqual({ type: "confirm" });
  });

  it("cancels on escape", () => {
    expect(handlePickerKey("\u001B", 0, items)).toEqual({ type: "cancel" });
  });

  it("counts rows including create", () => {
    expect(pickerRowCount(3)).toBe(4);
  });
});
