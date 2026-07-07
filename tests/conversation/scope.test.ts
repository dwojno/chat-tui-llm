import { describe, expect, it, vi } from "vitest";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import { EphemeralScope, type ConversationScope } from "../../src/conversation/scope";
import { usage } from "../helpers/mock-openai";

function fakeParent(overrides: Partial<ConversationScope> = {}): ConversationScope {
  return {
    summary: "parent summary",
    facts: ["parent fact"],
    cacheKey: "chat-cli:parent",
    setSummary: vi.fn(),
    addResponseUsage: vi.fn(),
    addSummarizerUsage: vi.fn(),
    ...overrides,
  };
}

describe("EphemeralScope", () => {
  it("inherits the parent facts but keeps its own summary", () => {
    const scope = new EphemeralScope(fakeParent());
    expect(scope.facts).toEqual(["parent fact"]);
    expect(scope.summary).toBe(""); // starts empty, independent of parent

    scope.setSummary("child summary");
    expect(scope.summary).toBe("child summary");
  });

  it("uses a distinct fork cache key", () => {
    const scope = new EphemeralScope(fakeParent());
    expect(scope.cacheKey).toMatch(/^chat-cli:fork:/);
  });

  it("rolls usage up to the parent so the session report stays accurate", () => {
    const parent = fakeParent();
    const scope = new EphemeralScope(parent);
    const u: ResponseUsage = usage();

    scope.addResponseUsage(u);
    scope.addSummarizerUsage(u);

    expect(parent.addResponseUsage).toHaveBeenCalledWith(u);
    expect(parent.addSummarizerUsage).toHaveBeenCalledWith(u);
  });
});
