import { describe, expect, it } from "vitest";
import assert from "node:assert";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { getFunctionCalls, renderItemsText } from "@/agent/conversation/items";
import { assistantMessage, functionCall } from "@tests/helpers/mock-openai";

const user = (content: string): ResponseInputItem => ({
  role: "user",
  content,
});
const toolOutput = (output: string): ResponseInputItem => ({
  type: "function_call_output",
  call_id: "c1",
  output,
});

describe("getFunctionCalls", () => {
  it("extracts function calls from output", () => {
    const output = [
      functionCall("get_weather_data", { city: "Paris" }),
      assistantMessage("hi"),
    ] as never;

    const calls = getFunctionCalls(output);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    assert(call !== undefined);
    expect(call.name).toBe("get_weather_data");
  });

  it("returns nothing for a plain message", () => {
    expect(getFunctionCalls([assistantMessage("hi")] as never)).toEqual([]);
  });
});

describe("renderItemsText", () => {
  it("flattens roles, function calls, and tool outputs into text", () => {
    const items = [
      user("hello"),
      functionCall("get_weather_data", { city: "Paris" }, "c1") as never,
      toolOutput("sunny"),
    ];
    expect(renderItemsText(items)).toBe(
      [
        "user: hello",
        'assistant called get_weather_data({"city":"Paris"})',
        "tool result: sunny",
      ].join("\n"),
    );
  });

  it("extracts text from array-shaped content parts", () => {
    const item = {
      role: "assistant",
      content: [
        { type: "output_text", text: "part-a" },
        { type: "output_text", text: "part-b" },
      ],
    } as unknown as ResponseInputItem;
    expect(renderItemsText([item])).toBe("assistant: part-apart-b");
  });
});
