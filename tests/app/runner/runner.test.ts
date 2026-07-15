import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub tool *execution* so the loop runs offline and instantly. Everything
// else from the tools module — describeToolCall, toolLabel — stays real.
vi.mock("@/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/agent/tools")>();
  return {
    ...actual,
    executeToolCall: vi.fn(async () => "TOOL_RESULT"),
  };
});

import { z } from "zod";
import { executeToolCall } from "@/agent/tools";
import type { ToolDefinition } from "@/agent/tools/types";
import type { TurnEvent } from "@/agent/events/events";
import { EventBus } from "@/agent/events/bus";
import type { TurnContext, TurnProfile } from "@/agent/conversation/turn";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "@/agent/conversation/options";
import { Agent } from "@/agent/agent";
import { runAgentLoop } from "@/app/runner/runner";
import type { AgentEvent } from "@/app/runner/thread/events";
import { createMockOpenAI, type MockTurn } from "@tests/helpers/mock-openai";

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

const userMessage = (content: string): AgentEvent => ({ type: "user_message", content });

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
  events: AgentEvent[],
  options: TurnOptions = DEFAULT_TURN_OPTIONS,
  profile?: TurnProfile,
) {
  const busEvents: TurnEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => busEvents.push(e));
  const result = await runAgentLoop({
    agent,
    events,
    options,
    context: { memories: [] },
    bus,
    maxToolSteps: 8,
    maxConsecutiveErrors: 3,
    ...(profile ? { profile } : {}),
  });
  return { events: busEvents, result };
}

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

  it("returns produced events and keeps no state between runs", async () => {
    const { agent } = makeAgent([{ text: "first" }, { text: "second" }]);

    const first = await run(agent, [userMessage("one")]);
    // The caller owns the user message; only the produced events come back.
    expect(first.result.events.some((e) => e.type === "user_message")).toBe(false);
    expect(first.result.events.at(-1)).toMatchObject({
      type: "assistant_answer",
      content: "first",
    });
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

    const output = result.events.find((e) => e.type === "tool_result");
    expect(output).toMatchObject({ output: "The weather in Paris is sunny" });
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

  it("turns a thrown tool into a compact error event instead of aborting", async () => {
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

    const error = result.events.find((e) => e.type === "error");
    expect(error).toMatchObject({ type: "error", name: "get_weather_data", message: "boom" });
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

async function runCtx(agent: Agent, seed: AgentEvent[], context: TurnContext) {
  const busEvents: TurnEvent[] = [];
  const bus = new EventBus();
  bus.subscribe((e) => busEvents.push(e));
  const result = await runAgentLoop({
    agent,
    events: seed,
    options: DEFAULT_TURN_OPTIONS,
    context,
    bus,
    maxToolSteps: 8,
    maxConsecutiveErrors: 3,
  });
  return { events: busEvents, result };
}

describe("runAgentLoop control intents", () => {
  it("terminates on done_for_now, formatting the answer with sources", async () => {
    const { agent } = makeAgent([
      { calls: [{ name: "done_for_now", arguments: { answer: "42", sources: ["s1"] } }] },
    ]);
    const { result } = await run(agent, [userMessage("q")]);
    expect(result.answer).toBe("42\n\nSources: s1");
    expect(result.events.at(-1)).toMatchObject({ type: "assistant_answer", sources: ["s1"] });
    expect(exec).not.toHaveBeenCalled();
  });

  it("terminates on done_for_now with null sources as a bare answer", async () => {
    const { agent } = makeAgent([
      { calls: [{ name: "done_for_now", arguments: { answer: "just this", sources: null } }] },
    ]);
    const { result } = await run(agent, [userMessage("q")]);
    expect(result.answer).toBe("just this");
    expect(result.events.at(-1)).not.toHaveProperty("sources");
  });

  it("done_for_now wins over a work tool in the same response", async () => {
    const { agent } = makeAgent([
      {
        calls: [
          { name: "get_weather_data", arguments: { city: "Paris" } },
          { name: "done_for_now", arguments: { answer: "done", sources: null } },
        ],
      },
    ]);
    const { result } = await run(agent, [userMessage("q")]);
    expect(result.answer).toBe("done");
    expect(exec).not.toHaveBeenCalled();
  });

  it("runs the clarification gate for request_more_information and continues", async () => {
    const { agent } = makeAgent([
      {
        calls: [
          {
            name: "request_more_information",
            arguments: { question: "which city?", reason: null, options: null },
          },
        ],
      },
      { text: "Thanks — Paris it is." },
    ]);
    const asked: string[] = [];
    const ctx: TurnContext = {
      memories: [],
      requestClarification: async (req) => {
        asked.push(req.question);
        return { answer: "Paris" };
      },
    };
    const { result } = await runCtx(agent, [userMessage("weather?")], ctx);
    expect(asked).toEqual(["which city?"]);
    expect(result.events.some((e) => e.type === "human_response")).toBe(true);
    expect(result.answer).toBe("Thanks — Paris it is.");
  });

  it("self-heals a malformed done_for_now into an error and recovers", async () => {
    const { agent } = makeAgent([
      { calls: [{ name: "done_for_now", arguments: '{"answer":"oops' }] }, // truncated JSON
      { text: "here is a plain answer" },
    ]);
    const { result } = await run(agent, [userMessage("q")]);
    expect(result.events.some((e) => e.type === "error" && e.name === "done_for_now")).toBe(true);
    expect(result.answer).toBe("here is a plain answer");
  });

  it("escalates to the human after MAX_CONSECUTIVE_ERRORS when a gate is present", async () => {
    exec.mockImplementation(async () => {
      throw new Error("boom");
    });
    const turns: MockTurn[] = [
      { calls: [{ name: "get_weather_data", arguments: { city: "A" } }] },
      { calls: [{ name: "get_weather_data", arguments: { city: "B" } }] },
      { calls: [{ name: "get_weather_data", arguments: { city: "C" } }] },
      { text: "giving up gracefully" },
    ];
    const { agent } = makeAgent(turns);
    const escalations: string[] = [];
    const ctx: TurnContext = {
      memories: [],
      requestClarification: async (req) => {
        escalations.push(req.question);
        return { answer: "stop" };
      },
    };
    const { result } = await runCtx(agent, [userMessage("do it")], ctx);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatch(/repeated tool errors/);
    expect(result.answer).toBe("giving up gracefully");
  });

  it("does NOT escalate without a clarification gate (runs to the step cap)", async () => {
    exec.mockImplementation(async () => {
      throw new Error("boom");
    });
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: "get_weather_data", arguments: { city: "X" } }],
    }));
    turns.push({ text: "forced answer" });
    const { agent } = makeAgent(turns);
    const { result } = await run(agent, [userMessage("do it")]);
    expect(exec).toHaveBeenCalledTimes(8);
    expect(result.answer).toBe("forced answer");
  });
});
