import { describe, expect, it } from "vitest";
import { buildContextBlock } from "../../src/agent/dynamicContext/context";

const contentOf = (block: ReturnType<typeof buildContextBlock>): string =>
  block.length ? String((block[0] as { content: string }).content) : "";

describe("buildContextBlock", () => {
  it("returns nothing when there are no facts", () => {
    expect(buildContextBlock({ facts: [] })).toEqual([]);
  });

  it("renders pinned facts in a user_known_facts section", () => {
    const block = buildContextBlock({
      facts: ["likes tea", "lives in Berlin"],
    });
    expect(block).toHaveLength(1);
    expect((block[0] as { role: string }).role).toBe("developer");
    const content = contentOf(block);
    expect(content).toContain("<user_known_facts>");
    expect(content).toContain("- likes tea");
    expect(content).toContain("- lives in Berlin");
    expect(content).not.toContain("<conversation_summary>");
  });

  it("includes the discretion rules when facts are injected", () => {
    const content = contentOf(buildContextBlock({ facts: ["x"] }));
    expect(content).toContain("<context>");
    expect(content).toContain("never volunteer them");
    expect(content).toContain("<user_known_facts>");
    expect(content).not.toContain("<conversation_summary>");
  });
});
