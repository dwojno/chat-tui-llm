import { describe, expect, it } from "vitest";
import { formatAssistantContent, formatResponse, ResponseSchema } from "@chat/engine";

describe("formatAssistantContent", () => {
  it("returns the bare answer when there are no sources", () => {
    expect(formatAssistantContent("the answer", [])).toBe("the answer");
    expect(formatAssistantContent("the answer", undefined)).toBe("the answer");
  });

  it("appends sources when present", () => {
    expect(formatAssistantContent("the answer", ["a", "b"])).toBe("the answer\n\nSources: a\nb");
  });

  it("tolerates a missing answer", () => {
    expect(formatAssistantContent(undefined, undefined)).toBe("");
  });
});

describe("formatResponse", () => {
  it("returns output_text for a plain turn", () => {
    expect(
      formatResponse(
        { outputText: "plain answer", outputParsed: null },
        { structured_output: undefined, json_mode: false },
      ),
    ).toBe("plain answer");
  });

  it("formats structured output as answer + sources", () => {
    expect(
      formatResponse(
        {
          outputText: '{"answer":"hi","sources":["s1"]}',
          outputParsed: { answer: "hi", sources: ["s1"] },
        },
        { structured_output: ResponseSchema, json_mode: false },
      ),
    ).toBe("hi\n\nSources: s1");
  });
});
