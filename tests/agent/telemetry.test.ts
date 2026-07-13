import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { type Span, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentService } from "../../src/agent/agent";
import {
  bindActive,
  configureTelemetry,
  contextWithSpan,
  withSpan,
} from "../../src/agent/telemetry";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import type { TurnEvent } from "../../src/agent/events/events";
import type { ToolDefinition } from "../../src/agent/tools/types";
import { Session } from "../../src/integration/session";
import { collect } from "../../src/utils/async-gen";
import { createMemoryStore, createMockOpenAI, type MockTurn } from "../helpers/mock-openai";

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
  async *execute(): AsyncGenerator<TurnEvent, string> {
    // Mimic a store-path span (embeddings/rerank): it relies purely on the
    // ambient active context being the execute_tool span, with no explicit
    // parent threaded in — so it proves ALS binding survives it-merge.
    trace.getTracer("test").startActiveSpan("store.lookup", (child) => child.end());
    return "sunny";
  },
  summarize: ({ city }) => city,
};

const user = (content: string): ResponseInputItem => ({ role: "user", content });

// A leaf that emits a span relying only on ambient context, driven through an
// outer `for await` — the shape Session.runTurn / runFork feed to withSpan.
async function* deepLeaf(): AsyncGenerator<string, void> {
  trace.getTracer("test").startActiveSpan("deep.work", (s) => s.end());
  yield "leaf";
}
async function* nestedLoop(): AsyncGenerator<string, void> {
  for await (const value of deepLeaf()) yield value;
}

// ReadableSpan exposes its parent via parentSpanContext (2.x) or parentSpanId (1.x).
const parentId = (span: unknown): string | undefined => {
  const s = span as { parentSpanContext?: { spanId: string }; parentSpanId?: string };
  return s.parentSpanContext?.spanId ?? s.parentSpanId;
};

function drive(turns: MockTurn[], parent?: Span) {
  const mock = createMockOpenAI(turns);
  const service = new AgentService(mock.client, { tools: [weatherTool] });
  const gen = service.run([user("weather in paris?")], undefined, { memories: [] });
  // The turn span is linked via the ambient active context, not TurnContext —
  // bindActive is how Session/runFork nest the agent loop under their span.
  return collect(parent ? bindActive(contextWithSpan(parent), gen) : gen);
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
    expect(chat.map((s) => s.attributes["gen_ai.step"]).toSorted()).toEqual([0, 1]);
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
    // Tool I/O is captured as JSON: model args in, tool result out.
    expect(tool?.attributes["langfuse.observation.input"]).toBe(JSON.stringify({ city: "Paris" }));
    expect(tool?.attributes["langfuse.observation.output"]).toBe(JSON.stringify("sunny"));

    // Store-path span nests under execute_tool purely via ambient context —
    // this is the ALS binding surviving it-merge's concurrent tool driving.
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
    // Streamed rounds carry the completion start time Langfuse derives TTFT from.
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
    const agent = new AgentService(mock.client, { tools: [weatherTool] });
    const session = await Session.create(agent, mock.client, store, 4);
    await collect(session.runTurn("weather?", DEFAULT_TURN_OPTIONS));

    const turn = exporter.getFinishedSpans().find((s) => s.name === "chat.turn");
    expect(turn).toBeDefined();
    // Recorded from the first streamed text delta (after the tool round), not a
    // per-generation completion_start_time — so it's a whole-turn wall-clock.
    const ttft = turn?.attributes["chat.turn.time_to_first_token_ms"];
    expect(typeof ttft).toBe("number");
    expect(ttft as number).toBeGreaterThanOrEqual(0);
  });

  it("withSpan keeps its span ambient through an inner for-await loop", async () => {
    // Mirrors Session.runTurn / runFork: withSpan binds the outer generator,
    // which drives an inner generator via `for await`; a span created deep
    // inside the inner loop must still nest under withSpan's span.
    await collect(
      withSpan("wrapper.turn", { attributes: { "test.marker": 1 }, input: "prompt" }, () =>
        nestedLoop(),
      ),
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
