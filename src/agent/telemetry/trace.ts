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

export function configureTelemetry(opts: { captureContent?: boolean }): void {
  if (opts.captureContent !== undefined) captureContent = opts.captureContent;
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

/**
 * Make `ctx` the active OTel context for every resumption of `gen`.
 *
 * OTel's active context rides on `AsyncLocalStorage`, which an external
 * generator driver (a `for await`, or `it-merge` racing parallel tool calls)
 * does not preserve across `yield` — the driver resumes `.next()` in *its* own
 * context. Re-entering `ctx` on each `.next()` keeps the binding local to this
 * generator, so spans created downstream nest under `ctx` and parallel siblings
 * stay isolated without the driver needing to know about tracing.
 */
export function bindActive<T, R>(ctx: Context, gen: AsyncGenerator<T, R>): AsyncGenerator<T, R> {
  return (async function* bound() {
    let step = await context.with(ctx, () => gen.next());
    while (!step.done) {
      yield step.value;
      step = await context.with(ctx, () => gen.next());
    }
    return step.value;
  })();
}

/** Context with `span` active — pass to {@link bindActive} to nest a generator's spans under it. */
export function contextWithSpan(span: Span): Context {
  return trace.setSpan(context.active(), span);
}

/**
 * Run a generator under a fresh span whose lifecycle this helper owns: it starts
 * the span (ambient parent), records `input`, keeps the span active for every
 * resumption via {@link bindActive} so downstream spans nest under it, and ends
 * it — recording and re-raising an unexpected throw. Callers only supply the
 * span's identity and the work; they never touch context primitives. `run`
 * receives the span for site-specific attributes/output (e.g. the final answer).
 */
export async function* withSpan<T, R>(
  name: string,
  init: { attributes?: Attributes; input?: unknown },
  run: (span: Span) => AsyncGenerator<T, R>,
): AsyncGenerator<T, R> {
  const span = startSpan(name, init.attributes ? { attributes: init.attributes } : {});
  if (init.input !== undefined) setSpanIO(span, { input: init.input });
  try {
    const result = yield* bindActive(contextWithSpan(span), run(span));
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

// Langfuse populates an observation's Input/Output from these attributes (not
// from span events), and expects each as a JSON string. Set both so the trace UI
// shows request/response content.
const LANGFUSE_INPUT = "langfuse.observation.input";
const LANGFUSE_OUTPUT = "langfuse.observation.output";
export const LANGFUSE_OBSERVATION_TYPE = "langfuse.observation.type";
export const LANGFUSE_MODEL_NAME = "langfuse.observation.model.name";
const LANGFUSE_COMPLETION_START_TIME = "langfuse.observation.completion_start_time";

/**
 * Record when the first output token arrived for a single model call. Langfuse
 * derives that generation's "Time to first token" from this
 * (`completion_start_time` − span start) — a plain span event is not read for
 * it. Per-call: it excludes any earlier tool rounds in the same turn.
 */
export function recordCompletionStart(span: Span, at: Date): void {
  span.setAttribute(LANGFUSE_COMPLETION_START_TIME, at.toISOString());
}

const CHAT_TURN_TTFT_MS = "chat.turn.time_to_first_token_ms";

/**
 * Record user-facing time-to-first-token on the turn span: wall-clock from turn
 * start to the first text token streamed to the user, spanning the whole turn
 * (tool rounds included). Distinct from a generation's per-call
 * `completion_start_time`; Langfuse has no turn-level TTFT widget, so this rides
 * as an attribute + metric rather than the built-in generation field.
 */
export function recordTurnTimeToFirstToken(span: Span, seconds: number, model: string): void {
  span.setAttribute(CHAT_TURN_TTFT_MS, Math.round(seconds * 1000));
  turnTtftHistogram.record(seconds, { [GEN_AI.requestModel]: model });
}

/** JSON-encode a value; pass through strings that are already valid JSON so args aren't double-encoded. */
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

/** Attach request/response content to a span (Input/Output in Langfuse); no-op when capture is off. */
export function setSpanIO(span: Span, io: { input?: unknown; output?: unknown }): void {
  if (!captureContent) return;
  if (io.input !== undefined && io.input !== null)
    span.setAttribute(LANGFUSE_INPUT, truncate(toJson(io.input)));
  if (io.output !== undefined && io.output !== null)
    span.setAttribute(LANGFUSE_OUTPUT, truncate(toJson(io.output)));
}

/**
 * Run `fn` inside an active LLM span, stamping the standard GenAI + Langfuse
 * attributes and handling the span lifecycle. Uses an active span (not an
 * explicit parent) so store-path spans nest under the ambient tool context. The
 * callback owns usage/IO and any graceful fallback; only an unexpected throw is
 * recorded as a span error and re-raised.
 */
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
