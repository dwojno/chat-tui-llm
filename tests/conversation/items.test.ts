import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import {
  countUserTurns,
  getFunctionCalls,
  hasFunctionCalls,
  renderItemsText,
  splitAtLastTurns,
  toReplayInputItems,
} from "../../src/conversation/items";
import { assistantMessage, functionCall } from "../helpers/mock-openai";

const user = (content: string): ResponseInputItem => ({ role: "user", content });
const toolOutput = (output: string): ResponseInputItem => ({
  type: "function_call_output",
  call_id: "c1",
  output,
});

describe("function-call helpers", () => {
  it("detects and extracts function calls in output", () => {
    const output = [
      functionCall("get_weather_data", { city: "Paris" }),
      assistantMessage("hi"),
    ] as never;

    expect(hasFunctionCalls(output)).toBe(true);
    const calls = getFunctionCalls(output);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("get_weather_data");
  });

  it("reports no function calls for a plain message", () => {
    expect(hasFunctionCalls([assistantMessage("hi")] as never)).toBe(false);
    expect(getFunctionCalls([assistantMessage("hi")] as never)).toEqual([]);
  });
});

describe("toReplayInputItems", () => {
  it("rebuilds a function_call as a clean replayable item (drops parsed_arguments)", () => {
    const call = {
      ...functionCall("get_weather_data", { city: "Paris" }, "call_9"),
      parsed_arguments: { city: "Paris" },
    };
    const [item] = toReplayInputItems([call] as never);
    expect(item).toEqual({
      type: "function_call",
      call_id: "call_9",
      name: "get_weather_data",
      arguments: JSON.stringify({ city: "Paris" }),
    });
    expect(item).not.toHaveProperty("parsed_arguments");
  });
});

describe("countUserTurns", () => {
  it("counts only user messages", () => {
    const items = [
      user("a"),
      toolOutput("r"),
      user("b"),
      { role: "assistant", content: "x" } as ResponseInputItem,
    ];
    expect(countUserTurns(items)).toBe(2);
  });
});

describe("splitAtLastTurns", () => {
  it("keeps everything when there are not more than keepTurns user turns", () => {
    const items = [user("a"), user("b")];
    expect(splitAtLastTurns(items, 4)).toEqual({ evicted: [], kept: items });
  });

  it("cuts at a user boundary, keeping the last N turns", () => {
    const a = user("a");
    const aOut = toolOutput("a-result");
    const b = user("b");
    const c = user("c");
    const { evicted, kept } = splitAtLastTurns([a, aOut, b, c], 2);
    // Keep last 2 user turns (b, c); evict the first turn (a + its tool output).
    expect(evicted).toEqual([a, aOut]);
    expect(kept).toEqual([b, c]);
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
