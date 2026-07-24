import {
  context,
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanKind,
} from "@opentelemetry/api";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { TraceToolExecution } from "@chat/agent";
import { redactPII } from "../utils/redact";
import { estimateCost } from "./pricing";

export const TELEMETRY_SCOPE = "chat-cli";

export const GEN_AI = {
  system: "gen_ai.system",
  operation: "gen_ai.operation.name",
  requestModel: "gen_ai.request.model",
  requestTemperature: "gen_ai.request.temperature",
  inputTokens: "gen_ai.usage.input_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  cachedTokens: "gen_ai.usage.cached_input_tokens",
  finishReasons: "gen_ai.response.finish_reasons",
  cost: "gen_ai.usage.cost",
  tokenType: "gen_ai.token.type",
} as const;

const CONTENT_MAX_CHARS = 8000;

let captureContent = true;
let redactEnabled = true;

export function configureTelemetry(opts: { captureContent?: boolean; redactPii?: boolean }): void {
  if (opts.captureContent !== undefined) captureContent = opts.captureContent;
  if (opts.redactPii !== undefined) redactEnabled = opts.redactPii;
}

export function isContentCaptureEnabled(): boolean {
  return captureContent;
}

const meter = metrics.getMeter(TELEMETRY_SCOPE);
const tokenCounter = meter.createCounter("gen_ai.client.token.usage", {
  description: "GenAI tokens consumed, by model and type",
});
const costCounter = meter.createCounter("gen_ai.client.cost.usd", {
  description: "Estimated GenAI spend in USD, by model",
});
const durationHistogram = meter.createHistogram("gen_ai.client.operation.duration", {
  unit: "s",
  description: "GenAI operation wall-clock duration",
});
const turnTtftHistogram = meter.createHistogram("gen_ai.client.turn.time_to_first_token", {
  unit: "s",
  description: "Wall-clock from turn start until the first response token reached the user",
});

export function getTracer() {
  return trace.getTracer(TELEMETRY_SCOPE);
}

export function startSpan(
  name: string,
  opts: {
    parent?: Span | undefined;
    attributes?: Attributes | undefined;
    kind?: SpanKind | undefined;
  } = {},
): Span {
  const parentCtx = opts.parent ? trace.setSpan(context.active(), opts.parent) : context.active();
  return getTracer().startSpan(
    name,
    {
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
      ...(opts.kind !== undefined ? { kind: opts.kind } : {}),
    },
    parentCtx,
  );
}

export function contextWithSpan(span: Span): Context {
  return trace.setSpan(context.active(), span);
}

export async function withSpan<R>(
  name: string,
  init: { attributes?: Attributes; input?: unknown },
  run: (span: Span) => Promise<R>,
): Promise<R> {
  const span = startSpan(name, init.attributes ? { attributes: init.attributes } : {});
  if (init.input !== undefined) setSpanIO(span, { input: init.input });
  try {
    const result = await context.with(contextWithSpan(span), () => run(span));
    endSpan(span);
    return result;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
}

export function endSpan(span: Span, error?: unknown): void {
  if (error !== undefined) {
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  }
  span.end();
}

function truncate(text: string): string {
  return text.length > CONTENT_MAX_CHARS ? `${text.slice(0, CONTENT_MAX_CHARS)}…` : text;
}

const LANGFUSE_INPUT = "langfuse.observation.input";
const LANGFUSE_OUTPUT = "langfuse.observation.output";
export const LANGFUSE_OBSERVATION_TYPE = "langfuse.observation.type";
export const LANGFUSE_MODEL_NAME = "langfuse.observation.model.name";
const LANGFUSE_COMPLETION_START_TIME = "langfuse.observation.completion_start_time";

export function recordCompletionStart(span: Span, at: Date): void {
  span.setAttribute(LANGFUSE_COMPLETION_START_TIME, at.toISOString());
}

const CHAT_TURN_TTFT_MS = "chat.turn.time_to_first_token_ms";

export function recordTurnTimeToFirstToken(span: Span, seconds: number, model: string): void {
  span.setAttribute(CHAT_TURN_TTFT_MS, Math.round(seconds * 1000));
  turnTtftHistogram.record(seconds, { [GEN_AI.requestModel]: model });
}

function toJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value) ?? "";
}

function formatIO(value: unknown): string {
  const json = toJson(value);
  return truncate(redactEnabled ? redactPII(json) : json);
}

export function setSpanIO(span: Span, io: { input?: unknown; output?: unknown }): void {
  if (!captureContent) return;
  if (io.input !== undefined && io.input !== null)
    span.setAttribute(LANGFUSE_INPUT, formatIO(io.input));
  if (io.output !== undefined && io.output !== null)
    span.setAttribute(LANGFUSE_OUTPUT, formatIO(io.output));
}

export const traceToolExecution: TraceToolExecution = ({ name, attributes, input, run }) =>
  withSpan(name, { attributes, input }, (span) => run((output) => setSpanIO(span, { output })));

export async function withLlmSpan<T>(
  name: string,
  init: {
    model: string;
    operation: string;
    observationType?: "generation" | "embedding";
    attributes?: Attributes;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, async (span) => {
    span.setAttribute(LANGFUSE_OBSERVATION_TYPE, init.observationType ?? "generation");
    span.setAttribute(LANGFUSE_MODEL_NAME, init.model);
    span.setAttribute(GEN_AI.system, "openai");
    span.setAttribute(GEN_AI.operation, init.operation);
    span.setAttribute(GEN_AI.requestModel, init.model);
    if (init.attributes) span.setAttributes(init.attributes);
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  });
}

export interface LlmSpanData {
  model: string;
  operation: string;
  usage?: ResponseUsage | undefined;
  temperature?: number | undefined;
  finishReasons?: string[] | undefined;
  durationSeconds?: number | undefined;
  input?: string | undefined;
  output?: string | undefined;
}

export function recordLlmSpan(span: Span, data: LlmSpanData): void {
  span.setAttribute(LANGFUSE_OBSERVATION_TYPE, "generation");
  span.setAttribute(LANGFUSE_MODEL_NAME, data.model);
  span.setAttribute(GEN_AI.system, "openai");
  span.setAttribute(GEN_AI.operation, data.operation);
  span.setAttribute(GEN_AI.requestModel, data.model);
  if (data.temperature !== undefined)
    span.setAttribute(GEN_AI.requestTemperature, data.temperature);
  if (data.finishReasons?.length) span.setAttribute(GEN_AI.finishReasons, data.finishReasons);

  const attrs = { [GEN_AI.requestModel]: data.model };
  if (data.durationSeconds !== undefined) durationHistogram.record(data.durationSeconds, attrs);

  const usage = data.usage;
  if (usage) {
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    span.setAttribute(GEN_AI.inputTokens, input);
    span.setAttribute(GEN_AI.outputTokens, output);
    if (cached) span.setAttribute(GEN_AI.cachedTokens, cached);
    tokenCounter.add(input, { ...attrs, [GEN_AI.tokenType]: "input" });
    tokenCounter.add(output, { ...attrs, [GEN_AI.tokenType]: "output" });

    const cost = estimateCost(data.model, { input, output, cached });
    if (cost !== undefined) {
      span.setAttribute(GEN_AI.cost, cost);
      costCounter.add(cost, attrs);
    }
  }

  setSpanIO(span, { input: data.input, output: data.output });
}
