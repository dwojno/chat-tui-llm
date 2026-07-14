import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub tool *execution* so the loop runs offline and instantly. Everything
// else from the tools module — describeToolCall, toolLabel — stays real.
vi.mock("../../src/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agent/tools")>();
  return {
    ...actual,
    executeToolCall: vi.fn(async () => "TOOL_RESULT"),
  };
});

import { z } from "zod";
import { executeToolCall } from "../../src/agent/tools";
import type { ToolDefinition } from "../../src/agent/tools/types";
import type { TurnEvent } from "../../src/agent/events/events";
import { EventBus } from "../../src/agent/events/bus";
import type { TurnProfile } from "../../src/agent/conversation/turn";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "../../src/agent/conversation/options";
import { Agent } from "../../src/agent/agent";
import { runAgentLoop } from "../../src/runner/runner";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { createMockOpenAI, type MockTurn } from "../helpers/mock-openai";

const exec = vi.mocked(executeToolCall);

const weatherParams = z.object({ city: z.string() });
const fakeWeatherTool: ToolDefinition<typeof weatherParams> = {
  name: "get_weather_data",
  label: "Fetching weather data",
  description: "test weather tool",
  parameters: weatherParams,
  execute: async () => "unused — execution is mocked",
  summarize: ({ city }) => city,
};

type Item = Record<string, unknown>;

const userMessage = (content: string): ResponseInputItem => ({ role: "user", content });

function makeAgent(turns: MockTurn[], compressions: string[] = []) {
  const mock = createMockOpenAI(turns, compressions);
  const agent = new Agent({
    openai: mock.client,
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: "system",
    tools: [fakeWeatherTool],
  });
  return { agent, mock };
}

async function run(
  agent: Agent,
  messages: ResponseInputItem[],
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
  profile?: TurnProfile,
) {
  const events: TurnEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => events.push(e));
  const result = await runAgentLoop({
    agent,
    messages,
    options,
    context: { memories: [] },
    bus,
    maxToolSteps: 8,
    ...(profile ? { profile } : {}),
  });
  return { events, result };
}

const items = (result: { items: ResponseInputItem[] }): Item[] => result.items as unknown as Item[];

const toolReturning = (output: string) => vi.fn(async () => output);

beforeEach(() => {
  exec.mockReset();
  exec.mockImplementation(async () => "TOOL_RESULT");
});

describe("runAgentLoop", () => {
  it("streams a plain answer and returns it", async () => {
    const { agent, mock } = makeAgent([{ text: "Hello there friend" }]);

    const { events, result } = await run(agent, [userMessage("hi")]);

    const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
    expect(deltas.join("")).toBe("Hello there friend");
    expect(result.answer).toBe("Hello there friend");

    expect(exec).not.toHaveBeenCalled();
    expect(mock.calls.stream).toHaveLength(1);
    expect(result.usage).toBeDefined();
  });

  it("returns produced items and keeps no state between runs", async () => {
    const { agent } = makeAgent([{ text: "first" }, { text: "second" }]);

    const first = await run(agent, [userMessage("one")]);
    // The caller owns the user message; only the assistant output comes back.
    expect(items(first.result).some((i) => i.role === "user")).toBe(false);
    expect(first.result.answer).toBe("first");

    const second = await run(agent, [userMessage("two")]);
    expect(second.result.answer).toBe("second");
  });

  it("runs a tool call, feeds the result back, and answers", async () => {
    exec.mockImplementationOnce(toolReturning("The weather in Paris is sunny"));
    const { agent, mock } = makeAgent([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "It is sunny in Paris." },
    ]);

    const { events, result } = await run(agent, [userMessage("weather in paris?")]);

    const toolEvent = events.find((e) => e.type === "tool");
    expect(toolEvent).toMatchObject({ type: "tool", name: "get_weather_data", detail: "Paris" });

    expect(exec).toHaveBeenCalledWith(
      expect.anything(),
      "get_weather_data",
      JSON.stringify({ city: "Paris" }),
      expect.anything(),
    );
    expect(mock.calls.stream).toHaveLength(2);

    const output = items(result).find((i) => i.type === "function_call_output");
    expect(output?.output).toBe("The weather in Paris is sunny");
    expect(result.answer).toBe("It is sunny in Paris.");
  });

  it("runs multiple tool calls in one round", async () => {
    const { agent } = makeAgent([
      {
        calls: [
          { name: "get_weather_data", arguments: { city: "Paris" } },
          { name: "get_weather_data", arguments: { city: "Tokyo" } },
        ],
      },
      { text: "done" },
    ]);

    const { events } = await run(agent, [userMessage("weather in paris and tokyo?")]);

    const toolEvents = events.filter((e) => e.type === "tool");
    expect(toolEvents.map((e) => e.detail)).toEqual(["Paris", "Tokyo"]);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("turns a thrown tool into an error output instead of aborting", async () => {
    exec.mockImplementationOnce(
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const { agent } = makeAgent([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "recovered" },
    ]);

    const { result } = await run(agent, [userMessage("weather?")]);

    const output = items(result).find((i) => i.type === "function_call_output");
    expect(output?.output).toBe("Error: boom");
    expect(result.answer).toBe("recovered");
  });

  it("lets a fork profile's model override options.model in the request", async () => {
    const { agent, mock } = makeAgent([{ text: "done" }]);
    const forkProfile: TurnProfile = {
      instructions: "fork",
      tools: [],
      cacheKey: "chat-cli:fork:test",
      model: "gpt-4o-mini",
    };

    await run(
      agent,
      [userMessage("hi")],
      { ...DEFAULT_TURN_OPTIONS, model: "gpt-4o" },
      forkProfile,
    );

    const params = mock.calls.stream[0] as { model?: string };
    expect(params.model).toBe("gpt-4o-mini");
  });

  it("forbids tools on the final round to stop an infinite tool loop", async () => {
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }],
    }));
    turns.push({ text: "forced answer" });

    const { agent, mock } = makeAgent(turns);
    const { result } = await run(agent, [userMessage("loop forever")]);

    expect(exec).toHaveBeenCalledTimes(8);
    const lastParams = mock.calls.stream.at(-1) as { tools: unknown[] };
    expect(mock.calls.stream).toHaveLength(9);
    expect(lastParams.tools).toEqual([]);
    expect(result.answer).toBe("forced answer");
  });
});
