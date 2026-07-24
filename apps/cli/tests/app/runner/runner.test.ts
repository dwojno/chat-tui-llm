import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@chat/agent/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@chat/agent/tools")>();
  return {
    ...actual,
    executeToolCall: vi.fn(async () => "TOOL_RESULT"),
  };
});

import { z } from "zod";
import { executeToolCall } from "@chat/agent/tools";
import type { ToolDefinition } from "@chat/agent/tools/types";
import type { TurnEvent } from "@chat/agent/events/events";
import { EventBus } from "@chat/agent/events/bus";
import type { TurnContext, TurnProfile } from "@chat/agent/conversation/turn";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "@chat/agent/conversation/options";
import { Model } from "@/platform/model";
import { Agent } from "@chat/agent/agent";
import { runAgentLoop } from "@/app/runner/runner";
import type { AgentEvent } from "@chat/agent";
import { createMockOpenAI, type MockTurn } from "@tests/helpers/mock-openai";
import assert from "node:assert";

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
    model: Model.fromOpenAI(mock.client),
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
  });

  it("returns produced events and keeps no state between runs", async () => {
    const { agent } = makeAgent([{ text: "first" }, { text: "second" }]);

    const first = await run(agent, [userMessage("one")]);

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

  it("sends the code-defined temperature for a classic (non-reasoning) model", async () => {
    const { agent, mock } = makeAgent([{ text: "ok" }]);
    await run(agent, [userMessage("hi")], { ...DEFAULT_TURN_OPTIONS, model: "gpt-4o-mini" });
    const params = mock.calls.stream[0] as { temperature?: number };
    expect(params.temperature).toBe(0.7);
  });

  it("omits temperature for a reasoning model that would reject it", async () => {
    const { agent, mock } = makeAgent([{ text: "ok" }]);
    await run(agent, [userMessage("hi")], { ...DEFAULT_TURN_OPTIONS, model: "gpt-5.6-luna" });
    const params = mock.calls.stream[0] as { temperature?: number };
    expect(params.temperature).toBeUndefined();
  });

  it("requests encrypted reasoning for a reasoning model but not a classic one", async () => {
    const reasoning = makeAgent([{ text: "ok" }]);
    await run(reasoning.agent, [userMessage("hi")], {
      ...DEFAULT_TURN_OPTIONS,
      model: "gpt-5.6-luna",
    });
    expect((reasoning.mock.calls.stream[0] as { include?: string[] }).include).toContain(
      "reasoning.encrypted_content",
    );

    const classic = makeAgent([{ text: "ok" }]);
    await run(classic.agent, [userMessage("hi")], {
      ...DEFAULT_TURN_OPTIONS,
      model: "gpt-4o-mini",
    });
    expect((classic.mock.calls.stream[0] as { include?: string[] }).include).toBeUndefined();
  });

  it("threads the previous step's tool call and result back as real items", async () => {
    exec.mockImplementationOnce(toolReturning("The weather in Paris is sunny"));
    const { agent, mock } = makeAgent([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "done" },
    ]);

    await run(agent, [userMessage("weather?")]);

    const secondInput = (mock.calls.stream[1] as { input: Record<string, unknown>[] }).input;
    const call = secondInput.find(
      (item) => item.type === "function_call" && item.name === "get_weather_data",
    );
    assert(call);
    const output = secondInput.find((item) => item.type === "function_call_output");
    assert(output);
    expect(String(output.output)).toContain("The weather in Paris is sunny");

    expect(call).not.toHaveProperty("parsed_arguments");

    const seed = secondInput[0] as { content?: string };
    expect(seed.content).not.toContain("The weather in Paris is sunny");
  });

  it("forbids tools on the final round to stop an infinite tool loop", async () => {
    const turns: MockTurn[] = Array.from({ length: 8 }, (_, i) => ({
      calls: [{ name: "get_weather_data", arguments: { city: `City${i}` } }],
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

describe("runAgentLoop guardrails", () => {
  it("runs a repeated identical tool call only once and reuses the result", async () => {
    const { agent } = makeAgent([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "done" },
    ]);

    const { result } = await run(agent, [userMessage("weather?")]);

    expect(exec).toHaveBeenCalledTimes(1);
    const results = result.events.filter((e) => e.type === "tool_result");
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.output === "TOOL_RESULT")).toBe(true);
    expect(result.answer).toBe("done");
  });

  it("re-executes an identical call after the first one errored", async () => {
    exec.mockReset();
    exec.mockRejectedValueOnce(new Error("boom"));
    exec.mockResolvedValue("recovered");
    const { agent } = makeAgent([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "done" },
    ]);

    await run(agent, [userMessage("weather?")]);

    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("collapses identical calls made in the same round to one execution", async () => {
    const { agent } = makeAgent([
      {
        calls: [
          { name: "get_weather_data", arguments: { city: "Paris" } },
          { name: "get_weather_data", arguments: { city: "Paris" } },
        ],
      },
      { text: "done" },
    ]);

    const { result } = await run(agent, [userMessage("weather twice?")]);

    expect(exec).toHaveBeenCalledTimes(1);
    expect(result.events.filter((e) => e.type === "tool_result")).toHaveLength(2);
  });

  it("cuts off a call that keeps erroring instead of retrying forever", async () => {
    exec.mockReset();
    exec.mockImplementation(async () => {
      throw new Error("boom");
    });
    const turns: MockTurn[] = Array.from({ length: 4 }, () => ({
      calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }],
    }));
    turns.push({ text: "gave up" });
    const { agent } = makeAgent(turns);

    const { result } = await run(agent, [userMessage("weather?")]);

    expect(exec).toHaveBeenCalledTimes(2);
    const errors = result.events.filter((e) => e.type === "error");
    expect(errors.some((e) => /keeps failing/.test(e.message))).toBe(true);
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

  it("threads a scratchpad-only step back to the next step without finishing", async () => {
    const { agent, mock } = makeAgent([
      {
        calls: [
          {
            name: "update_scratchpad",
            arguments: { sections: [{ section: "todo", content: "1. check weather" }] },
          },
        ],
      },
      { text: "all done" },
    ]);

    const { events, result } = await run(agent, [userMessage("plan it")]);

    expect(result.answer).toBe("all done");
    expect(exec).not.toHaveBeenCalled();
    expect(result.events.some((e) => e.type === "scratchpad")).toBe(true);
    expect(events).toContainEqual({
      type: "scratchpad",
      sections: [{ section: "todo", content: "1. check weather" }],
    });
    expect(mock.calls.stream).toHaveLength(2);

    const secondInput = (mock.calls.stream[1] as { input: Record<string, unknown>[] }).input;
    const call = secondInput.find(
      (item) => item.type === "function_call" && item.name === "update_scratchpad",
    );
    assert(call);
    expect(String(call.arguments)).toContain("1. check weather");
    const output = secondInput.find((item) => item.type === "function_call_output");
    assert(output);
    expect(String(output.output)).toContain("Scratchpad updated.");
  });

  it("records a malformed update_scratchpad as an error and continues", async () => {
    const { agent } = makeAgent([
      { calls: [{ name: "update_scratchpad", arguments: '{"sections":[' }] },
      { text: "recovered" },
    ]);
    const { result } = await run(agent, [userMessage("plan")]);
    expect(result.events.some((e) => e.type === "error" && e.name === "update_scratchpad")).toBe(
      true,
    );
    expect(result.answer).toBe("recovered");
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
    const turns: MockTurn[] = Array.from({ length: 8 }, (_, i) => ({
      calls: [{ name: "get_weather_data", arguments: { city: `X${i}` } }],
    }));
    turns.push({ text: "forced answer" });
    const { agent } = makeAgent(turns);
    const { result } = await run(agent, [userMessage("do it")]);
    expect(exec).toHaveBeenCalledTimes(8);
    expect(result.answer).toBe("forced answer");
  });
});
