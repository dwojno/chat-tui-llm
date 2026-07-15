import { describe, expect, it } from "vitest";
import { toYaml } from "@/app/runner/thread/yaml";

describe("toYaml", () => {
  it("quotes strings and renders bare scalars for numbers/booleans/null", () => {
    expect(toYaml("hi")).toBe('"hi"');
    expect(toYaml(42)).toBe("42");
    expect(toYaml(true)).toBe("true");
    expect(toYaml(null)).toBe("null");
  });

  it("escapes special characters and newlines via JSON quoting (single line)", () => {
    expect(toYaml("a: b\nc")).toBe('"a: b\\nc"');
  });

  it("renders a flat object as key/value lines", () => {
    expect(toYaml({ intent: "get_weather", city: "Paris" })).toBe(
      'intent: "get_weather"\ncity: "Paris"',
    );
  });

  it("indents nested objects by two spaces", () => {
    expect(toYaml({ intent: "deploy", args: { tag: "v1", prod: true } })).toBe(
      ['intent: "deploy"', "args:", '  tag: "v1"', "  prod: true"].join("\n"),
    );
  });

  it("renders arrays of scalars and arrays of objects", () => {
    expect(toYaml(["a", "b"])).toBe('- "a"\n- "b"');
    expect(toYaml({ tags: [{ name: "v1" }, { name: "v2" }] })).toBe(
      ["tags:", "  -", '    name: "v1"', "  -", '    name: "v2"'].join("\n"),
    );
  });

  it("renders empty collections inline", () => {
    expect(toYaml({})).toBe("{}");
    expect(toYaml([])).toBe("[]");
    expect(toYaml({ a: {}, b: [] })).toBe("a: {}\nb: []");
  });
});
