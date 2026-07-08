import { describe, expect, it } from "vitest";
import { mergeGenerators } from "../../src/agent/events/merge";

async function* gen<T, R>(
  yields: T[],
  result: R,
  delayMs = 0,
): AsyncGenerator<T, R> {
  for (const value of yields) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield value;
  }
  return result;
}

async function collect<T, R>(
  generators: AsyncGenerator<T, R>[],
): Promise<{ events: T[]; result: R[] }> {
  const { events, results } = mergeGenerators(generators);
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return { events: collected, result: await results };
}

describe("mergeGenerators", () => {
  it("yields every event from all generators and returns results in input order", async () => {
    const { events, result } = await collect([
      gen(["a1", "a2"], "A"),
      gen(["b1"], "B"),
    ]);

    expect([...events].toSorted()).toEqual(["a1", "a2", "b1"]);
    expect(result).toEqual(["A", "B"]);
  });

  it("includes a generator that yields nothing", async () => {
    const { events, result } = await collect([gen([], "X"), gen(["y"], "Y")]);

    expect(events).toEqual(["y"]);
    expect(result).toEqual(["X", "Y"]);
  });

  it("returns [] and yields nothing for no generators", async () => {
    const { events, result } = await collect<string, string>([]);

    expect(events).toEqual([]);
    expect(result).toEqual([]);
  });

  it("interleaves events as they arrive from concurrent generators", async () => {
    const { events, result } = await collect([
      gen(["slow"], "S", 20),
      gen(["fast"], "F", 0),
    ]);

    expect(events).toContain("slow");
    expect(events).toContain("fast");
    expect(result).toEqual(["S", "F"]);
  });
});
