import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub tool *execution* so the loop runs offline and instantly (the real
// weather tool sleeps 1s and web_search hits the network). Everything else
// from the tools module — describeToolCall, mainTools, forkTools — stays real.
vi.mock("../../src/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agent/tools")>();
  return {
    ...actual,
    executeToolCall: vi.fn(async function* () {
      return "TOOL_RESULT";
    }),
  };
});

import { executeToolCall } from "../../src/agent/tools";
import type { TurnEvent } from "../../src/agent/events/events";
import { AgentService } from "../../src/agent/agent";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { createMockOpenAI, type MockTurn } from "../helpers/mock-openai";

const exec = vi.mocked(executeToolCall);

// The ResponseInputItem union is awkward to narrow in tests; view it loosely.
type Item = Record<string, unknown>;

const userMessage = (content: string): ResponseInputItem => ({
  role: "user",
  content,
});

/** Transcript items the agent emitted as `message` events this turn. */
const emittedItems = (events: TurnEvent[]): Item[] =>
  events.flatMap((e) => (e.type === "message" ? [e.item as unknown as Item] : []));

const responseUsageCount = (events: TurnEvent[]): number =>
  events.filter((e) => e.type === "usage" && e.kind === "response").length;

async function collect(gen: AsyncGenerator<TurnEvent, void>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function makeService(turns: MockTurn[], compressions: string[] = []) {
  const mock = createMockOpenAI(turns, compressions);
  const service = new AgentService(mock.client);
  return { service, mock };
}

/** A tool run (async generator) that yields nothing and returns `output`. */
const toolReturning = (output: string) =>
  async function* (): AsyncGenerator<TurnEvent, string> {
    return output;
  };

/** A tool run that throws when first driven. */
const toolThrowing = (message: string) =>
  async function* (): AsyncGenerator<TurnEvent, string> {
    throw new Error(message);
  };

beforeEach(() => {
  exec.mockReset();
  exec.mockImplementation(toolReturning("TOOL_RESULT"));
});

describe("AgentService.run", () => {
  it("streams a plain answer and yields a final answer event", async () => {
    const { service, mock } = makeService([{ text: "Hello there friend" }]);

    const events = await collect(service.run([userMessage("hi")]));

    const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
    expect(deltas.join("")).toBe("Hello there friend");

    const answer = events.at(-1);
    expect(answer).toEqual({ type: "answer", content: "Hello there friend" });

    // No tools called, one model round, one response usage event.
    expect(exec).not.toHaveBeenCalled();
    expect(mock.calls.stream).toHaveLength(1);
    expect(responseUsageCount(events)).toBe(1);
  });

  it("emits produced items and keeps no state between runs", async () => {
    const { service } = makeService([{ text: "first" }, { text: "second" }]);

    const first = await collect(service.run([userMessage("one")]));
    // The final assistant message is emitted as a message event; the user
    // message (owned by the caller) is not re-emitted.
    expect(emittedItems(first).some((i) => i.role === "user")).toBe(false);
    expect(first.at(-1)).toEqual({ type: "answer", content: "first" });

    // A second run with only its own input is independent — no carryover.
    const second = await collect(service.run([userMessage("two")]));
    expect(second.at(-1)).toEqual({ type: "answer", content: "second" });
  });

  it("runs a tool call, feeds the result back, and answers", async () => {
    exec.mockImplementationOnce(toolReturning("The weather in Paris is sunny"));
    const { service, mock } = makeService([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "It is sunny in Paris." },
    ]);

    const events = await collect(service.run([userMessage("weather in paris?")]));

    // Tool step carries the localized name + arg-derived detail.
    const toolEvent = events.find((e) => e.type === "tool");
    expect(toolEvent).toMatchObject({
      type: "tool",
      name: "get_weather_data",
      detail: "Paris",
    });

    expect(exec).toHaveBeenCalledWith(
      "get_weather_data",
      JSON.stringify({ city: "Paris" }),
      expect.anything(),
    );
    expect(mock.calls.stream).toHaveLength(2); // tool round + answer round

    // A function_call_output carrying the tool result is emitted.
    const output = emittedItems(events).find((i) => i.type === "function_call_output");
    expect(output?.output).toBe("The weather in Paris is sunny");
    expect(events.at(-1)).toEqual({
      type: "answer",
      content: "It is sunny in Paris.",
    });
  });

  it("runs multiple tool calls in one round", async () => {
    const { service } = makeService([
      {
        calls: [
          { name: "get_weather_data", arguments: { city: "Paris" } },
          { name: "get_weather_data", arguments: { city: "Tokyo" } },
        ],
      },
      { text: "done" },
    ]);

    const events = await collect(service.run([userMessage("weather in paris and tokyo?")]));

    const toolEvents = events.filter((e) => e.type === "tool");
    expect(toolEvents.map((e) => e.detail)).toEqual(["Paris", "Tokyo"]);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("turns a thrown tool into an error output instead of aborting", async () => {
    exec.mockImplementationOnce(toolThrowing("boom"));
    const { service } = makeService([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "recovered" },
    ]);

    const events = await collect(service.run([userMessage("weather?")]));

    const output = emittedItems(events).find((i) => i.type === "function_call_output");
    expect(output?.output).toBe("Error: boom");
    expect(events.at(-1)).toEqual({ type: "answer", content: "recovered" });
  });

  // Delegation now flows through executeToolCall like any other tool, so it is
  // exercised end-to-end (with real tools + a stubbed fetch) in the e2e suite
  // rather than here, where executeToolCall is mocked.

  it("forbids tools on the final round to stop an infinite tool loop", async () => {
    // 8 tool-calling rounds, then a forced answer.
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }],
    }));
    turns.push({ text: "forced answer" });

    const { service, mock } = makeService(turns);
    const events = await collect(service.run([userMessage("loop forever")]));

    expect(exec).toHaveBeenCalledTimes(8);
    // The 9th (final) request must disable tools.
    const lastParams = mock.calls.stream.at(-1) as { tools: unknown[] };
    expect(mock.calls.stream).toHaveLength(9);
    expect(lastParams.tools).toEqual([]);
    expect(events.at(-1)).toEqual({ type: "answer", content: "forced answer" });
  });
});
