import { describe, expect, it } from "vitest";
import { buildContextBlock, keyMemories } from "../../src/agent/dynamicContext/context";

const contentOf = (block: ReturnType<typeof buildContextBlock>): string =>
  block.length ? String((block[0] as { content: string }).content) : "";

describe("keyMemories", () => {
  it("assigns positional M1..Mn keys over the ordered list", () => {
    expect(keyMemories(["likes tea", "uses vim"])).toEqual([
      { key: "M1", text: "likes tea" },
      { key: "M2", text: "uses vim" },
    ]);
  });

  it("returns nothing for an empty list", () => {
    expect(keyMemories([])).toEqual([]);
  });
});

describe("buildContextBlock", () => {
  it("returns nothing when there are no memories", () => {
    expect(buildContextBlock({ memories: [] })).toEqual([]);
  });

  it("renders numbered memories in a user_known_memories section", () => {
    const block = buildContextBlock({
      memories: ["likes tea", "lives in Berlin"],
    });
    expect(block).toHaveLength(1);
    expect((block[0] as { role: string }).role).toBe("developer");
    const content = contentOf(block);
    expect(content).toContain("<user_known_memories>");
    expect(content).toContain("M1: likes tea");
    expect(content).toContain("M2: lives in Berlin");
    expect(content).not.toContain("<conversation_summary>");
  });

  it("includes the discretion rules when memories are injected", () => {
    const content = contentOf(buildContextBlock({ memories: ["x"] }));
    expect(content).toContain("<context>");
    expect(content).toContain("never volunteer them");
    expect(content).toContain("<user_known_memories>");
    expect(content).not.toContain("<conversation_summary>");
  });
});
