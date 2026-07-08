import { describe, expect, it } from "vitest";
import { estimateTokens } from "../../src/agent/tokens/tokens";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 characters, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});
