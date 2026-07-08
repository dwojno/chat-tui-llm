import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliArgs } from "../../src/integration/args";

// Turn the process-exiting failure paths into throws we can assert on.
const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
  throw new Error(`exit:${code ?? 0}`);
}) as never);
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  exit.mockClear();
});

describe("parseCliArgs", () => {
  it("defaults temperature to 0.7", () => {
    expect(parseCliArgs([])).toEqual({ temperature: 0.7 });
  });

  it("reads -t / --temperature", () => {
    expect(parseCliArgs(["-t", "0.2"])).toEqual({ temperature: 0.2 });
    expect(parseCliArgs(["--temperature", "1.5"])).toEqual({ temperature: 1.5 });
  });

  it("exits non-zero on a non-numeric temperature", () => {
    expect(() => parseCliArgs(["-t", "hot"])).toThrow("exit:1");
    expect(console.error).toHaveBeenCalled();
  });

  it("exits non-zero on an unknown flag", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow("exit:1");
  });

  it("prints usage and exits zero on --help", () => {
    expect(() => parseCliArgs(["--help"])).toThrow("exit:0");
    expect(console.log).toHaveBeenCalled();
  });
});
