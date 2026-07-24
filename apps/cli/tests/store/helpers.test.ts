import { describe, expect, it } from "vitest";
import { asArray } from "@/store/helpers";

describe("asArray", () => {
  it("wraps a single value", () => {
    expect(asArray("a")).toEqual(["a"]);
  });

  it("passes through an array", () => {
    expect(asArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty batch", () => {
    expect(asArray([])).toEqual([]);
  });
});
