import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "@/platform/cli/args";


const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
  throw new Error(`exit:${code ?? 0}`);
}) as never);
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  exit.mockClear();
});

describe("parseCliArgs", () => {
  it("returns an empty object with no flags", () => {
    expect(parseCliArgs([])).toEqual({});
  });

  it("reads -c / --conversation", () => {
    const id = "a3f8c2e1-4b2d-4c5e-9f0a-123456789abc";
    expect(parseCliArgs(["-c", id])).toEqual({ conversationId: id });
    expect(parseCliArgs(["--conversation", id])).toEqual({ conversationId: id });
  });

  it("exits non-zero on an unknown flag", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow("exit:1");
    expect(() => parseCliArgs(["-t", "0.2"])).toThrow("exit:1");
  });

  it("prints usage and exits zero on --help", () => {
    expect(() => parseCliArgs(["--help"])).toThrow("exit:0");
    expect(console.log).toHaveBeenCalled();
  });
});
