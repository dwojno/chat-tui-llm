import type { AgentEvent } from "@/app/runner/thread/events";
import { context, type Span, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { configureTelemetry, contextWithSpan, withSpan } from "@/platform/telemetry";
import { DEFAULT_TURN_OPTIONS } from "@/agent/conversation/options";
import type { ToolDefinition } from "@/agent/tools/types";
import { EventBus } from "@/agent/events/bus";
import { runAgentLoop } from "@/app/runner/runner";
import { createMemoryStore, createMockOpenAI, type MockTurn } from "@tests/helpers/mock-openai";
import { testAgent, testSession } from "@tests/helpers/agent";

const exporter = new InMemorySpanExporter();
let provider: NodeTracerProvider;

beforeAll(() => {
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
  configureTelemetry({ captureContent: true });
});

const weatherParams = z.object({ city: z.string() });
const weatherTool: ToolDefinition<typeof weatherParams> = {
  name: "get_weather_data",
  label: "Fetching weather data",
  description: "test weather tool",
  parameters: weatherParams,
  // Mimic a store-path span: it relies purely on the ambient active context
  // being the execute_tool span, with no explicit parent threaded in.
  execute: async () => {
    trace.getTracer("test").startActiveSpan("store.lookup", (child) => child.end());
    return "sunny";
  },
  summarize: ({ city }) => city,
};

const user = (content: string): AgentEvent => ({ type: "user_message", content });

const parentId = (span: unknown): string | undefined => {
  const s = span as { parentSpanContext?: { spanId: string }; parentSpanId?: string };
  return s.parentSpanContext?.spanId ?? s.parentSpanId;
};

function drive(turns: MockTurn[], parent?: Span) {
  const mock = createMockOpenAI(turns);
  const agent = testAgent(mock.client, { tools: [weatherTool] });
  const run = () =>
    runAgentLoop({
      agent,
      events: [user("weather in paris?")],
      options: DEFAULT_TURN_OPTIONS,
      context: { memories: [] },
      bus: new EventBus(),
      maxToolSteps: 8,
      maxConsecutiveErrors: 3,
    });
  return parent ? context.with(contextWithSpan(parent), run) : run();
}

describe("agent telemetry", () => {
  it("nests a gen_ai.chat span per round and an execute_tool span under the turn", async () => {
    const root = trace.getTracer("test").startSpan("chat.turn");
    await drive(
      [
        { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
        { text: "It is sunny." },
      ],
      root,
    );
    root.end();

    const spans = exporter.getFinishedSpans();
    const rootId = root.spanContext().spanId;

    const chat = spans.filter((s) => s.name.startsWith("gen_ai.chat"));
    expect(chat).toHaveLength(2);
    for (const span of chat) {
      expect(span.attributes["gen_ai.system"]).toBe("openai");
      expect(span.attributes["gen_ai.usage.input_tokens"]).toBe(100);
      expect(span.attributes["gen_ai.usage.output_tokens"]).toBe(50);
      expect(span.attributes["gen_ai.usage.cost"] as number).toBeGreaterThan(0);
      expect(parentId(span)).toBe(rootId);
    }

    const tool = spans.find((s) => s.name === "execute_tool get_weather_data");
    expect(tool).toBeDefined();
    expect(tool?.attributes["gen_ai.tool.name"]).toBe("get_weather_data");
    expect(parentId(tool)).toBe(rootId);
    expect(tool?.attributes["langfuse.observation.input"]).toBe(JSON.stringify({ city: "Paris" }));
    expect(tool?.attributes["langfuse.observation.output"]).toBe(JSON.stringify("sunny"));

    // Store-path span nests under execute_tool purely via ambient context.
    const storeSpan = spans.find((s) => s.name === "store.lookup");
    expect(storeSpan).toBeDefined();
    expect(parentId(storeSpan)).toBe(tool?.spanContext().spanId);
  });

  it("attaches prompt/completion content attributes only when capture is enabled", async () => {
    await drive([{ text: "hi" }]);
    const withContent = exporter.getFinishedSpans().find((s) => s.name.startsWith("gen_ai.chat"));
    expect(withContent?.attributes["langfuse.observation.input"]).toBeDefined();
    expect(withContent?.attributes["langfuse.observation.output"]).toBe(JSON.stringify("hi"));
    expect(withContent?.attributes["langfuse.observation.type"]).toBe("generation");
    const startedAt = withContent?.attributes["langfuse.observation.completion_start_time"];
    expect(typeof startedAt).toBe("string");
    expect(Number.isNaN(Date.parse(startedAt as string))).toBe(false);

    exporter.reset();
    configureTelemetry({ captureContent: false });
    await drive([{ text: "hi" }]);
    const withoutContent = exporter
      .getFinishedSpans()
      .find((s) => s.name.startsWith("gen_ai.chat"));
    expect(withoutContent?.attributes["langfuse.observation.input"]).toBeUndefined();
    expect(withoutContent?.attributes["langfuse.observation.output"]).toBeUndefined();
  });

  it("records turn-level user-facing TTFT on chat.turn, spanning tool rounds", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      { calls: [{ name: "get_weather_data", arguments: { city: "Paris" } }] },
      { text: "It is sunny." },
    ]);
    const { session } = await testSession(mock.client, store, { tools: [weatherTool] });
    await session.runTurn("weather?", DEFAULT_TURN_OPTIONS);

    const turn = exporter.getFinishedSpans().find((s) => s.name === "chat.turn");
    expect(turn).toBeDefined();
    const ttft = turn?.attributes["chat.turn.time_to_first_token_ms"];
    expect(typeof ttft).toBe("number");
    expect(ttft as number).toBeGreaterThanOrEqual(0);
  });

  it("withSpan keeps its span ambient through the awaited work", async () => {
    await withSpan(
      "wrapper.turn",
      { attributes: { "test.marker": 1 }, input: "prompt" },
      async () => {
        trace.getTracer("test").startActiveSpan("deep.work", (s) => s.end());
      },
    );

    const spans = exporter.getFinishedSpans();
    const wrapper = spans.find((s) => s.name === "wrapper.turn");
    const deep = spans.find((s) => s.name === "deep.work");
    expect(wrapper?.attributes["test.marker"]).toBe(1);
    expect(wrapper?.attributes["langfuse.observation.input"]).toBe(JSON.stringify("prompt"));
    expect(deep).toBeDefined();
    expect(parentId(deep)).toBe(wrapper?.spanContext().spanId);
  });
});
