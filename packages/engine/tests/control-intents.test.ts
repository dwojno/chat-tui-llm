import { describe, expect, it } from "vitest";
import {
  CONTROL_INTENT_NAMES,
  isControlIntent,
  parseDoneForNowArgs,
  parseRequestMoreInformationArgs,
} from "@chat/engine/control-intents";

describe("control intents", () => {
  it("recognizes reserved names", () => {
    expect(isControlIntent("done_for_now")).toBe(true);
    expect(isControlIntent("request_more_information")).toBe(true);
    expect(isControlIntent("get_weather_data")).toBe(false);
    expect(CONTROL_INTENT_NAMES.size).toBe(2);
  });

  it("parses done_for_now args including nullable sources", () => {
    expect(parseDoneForNowArgs('{"answer":"done","sources":null}')).toEqual({
      answer: "done",
      sources: null,
    });
    expect(parseDoneForNowArgs('{"answer":"done","sources":["a.ts:1-2"]}').sources).toEqual([
      "a.ts:1-2",
    ]);
  });

  it("parses request_more_information args", () => {
    expect(
      parseRequestMoreInformationArgs('{"question":"which?","reason":null,"options":["a","b"]}'),
    ).toEqual({ question: "which?", reason: null, options: ["a", "b"] });
  });
});
