# Observability

The agent is instrumented with **OpenTelemetry** using the **GenAI semantic
conventions** (`gen_ai.*`). Traces and metrics are exported over OTLP/HTTP to a
self-hosted **Langfuse** stack (or any OTLP backend). Instrumentation is inert
until an OTel SDK is registered, so offline runs and tests are unaffected.

## Why the pure core imports `@opentelemetry/api`

The agent core is otherwise dependency-light and the OpenAI SDK is "injected,
never wrapped" (see [architecture.md](./architecture.md)). Observability is the
one sanctioned exception: the core imports `@opentelemetry/api` only. That package
is an **API surface, not an SDK** — every call is a no-op until the composition
root registers a provider (`startTelemetry` in
[src/telemetry/otel.ts](../src/telemetry/otel.ts)). It is
not an LLM/SDK abstraction, and it adds no I/O or state to the core, so the
stateless-core contract holds.

## How spans nest (ambient context across `await`)

The loop and tools are plain `async`/`await` (no generators). OTel's ambient
active-context rides on `AsyncLocalStorage`, which **is** preserved across `await`, so
nesting needs no per-step ceremony — the core keeps observability out of the domain
types (`TurnContext` carries no span) and relies on a single active-context wrapper:

- **`withSpan(name, init, run)`** ([src/telemetry/trace.ts](../src/telemetry/trace.ts))
  starts a span, runs `run(span)` inside `context.with(contextWithSpan(span), …)`, and
  ends it. Because the whole awaited call chain runs under that context, every span
  created downstream nests correctly. `Session.runTurn` wraps the turn span around
  `runAgentLoop`, `runFork` wraps the fork span, and `Agent.executeTool` wraps each
  tool span around the tool body.
- **Spans use ambient parents.** `startSpan(name)` reads `context.active()` for its
  parent, so `gen_ai.chat` / `execute_tool` nest under the turn span with no threading,
  and the store path (`store.sources.search()` → the embeddings/rerank
  `startActiveSpan` spans) nests under `execute_tool` automatically —
  `search_knowledge_base` contains **zero** tracing code.
  `tests/agent/telemetry.test.ts` asserts this nesting end-to-end.

## Span tree

```
chat.turn                         Session.runTurn — conversation.id, profile.id, chat.model, chat.turn.index, time_to_first_token_ms
├─ gen_ai.chat <model>            per model round — usage, cost, finish reason, completion-start time (TTFT)
├─ execute_tool <name>            per tool call (parallel-safe) — gen_ai.tool.name, args + result events
│   └─ chat.turn (fork)           delegate_task — chat.fork.title, chat.fork.profile, chat.fork.memories
│       ├─ gen_ai.chat <model>    the fork's own tool loop
│       ├─ execute_tool search_knowledge_base
│       │   ├─ gen_ai.embeddings  OpenAIDenseEmbedder.embed
│       │   └─ gen_ai.rerank      LlmReranker.rerank (records fallback as an event)
│       └─ gen_ai.handoff <model> compressHandoff → ForkResult (chat.fork.confidence)
└─ gen_ai.chat <model>            next round after tool outputs feed back
conversation.summarize            Session.maintainWindow — chat.evicted_turns, usage
```

## Attributes (GenAI semantic conventions)

| Attribute                          | Where set                                                  |
| ---------------------------------- | ---------------------------------------------------------- |
| `gen_ai.system` = `openai`         | every LLM span                                             |
| `gen_ai.operation.name`            | `chat` / `embeddings` / `rerank` / `handoff` / `summarize` |
| `gen_ai.request.model`             | every LLM span                                             |
| `gen_ai.request.temperature`       | chat spans                                                 |
| `gen_ai.usage.input_tokens`        | from the model's `usage` field                             |
| `gen_ai.usage.output_tokens`       | from the model's `usage` field                             |
| `gen_ai.usage.cached_input_tokens` | when prompt cache hits                                     |
| `gen_ai.usage.cost`                | USD, from the price table (below)                          |
| `gen_ai.response.finish_reasons`   | response status                                            |

When `OTEL_CAPTURE_CONTENT=true` (default) spans also carry request/response
content in the `langfuse.observation.input` / `langfuse.observation.output`
attributes — the `chat.turn` root gets the user prompt + final answer, each
`gen_ai.chat` span its request items + completion (the raw tool-call items when a
round emits no text), tool spans their args + result, and forks their brief +
`ForkResult`. Langfuse maps these attributes to an observation's Input/Output
panels — it does **not** read span events for this, and it expects each value as a
**JSON string**, so `setSpanIO` JSON-encodes everything (a bare completion like
`It is sunny.` would otherwise show as empty output). LLM spans also set
`langfuse.observation.type = "generation"` (embeddings → `embedding`) so they
render as generations rather than plain spans; the root `chat.turn` deliberately
avoids a `model` attribute so it stays the trace root. Content is truncated to 8 KB.

### Time to first token — two different numbers

- **Per-call (Langfuse-native).** Streaming `gen_ai.chat` spans set
  `langfuse.observation.completion_start_time` (wall-clock ISO-8601, via
  `recordCompletionStart`) at the first output token. Langfuse renders a
  generation's **Time to First Token** from this (`completion_start_time` − span
  start); it does **not** read a span event, so a custom `addEvent` never
  surfaces. This is per model call only — it excludes any earlier tool rounds, and
  non-streaming rounds (e.g. forks) omit it.
- **User-facing (turn-level).** What the user actually waited for — turn start to
  the first text token streamed to them, spanning any tool-call rounds in between.
  `Session.driveTurn` records it on the `chat.turn` root as the
  `chat.turn.time_to_first_token_ms` attribute plus the
  `gen_ai.client.turn.time_to_first_token` metric (via `recordTurnTimeToFirstToken`).
  Langfuse has no turn-level TTFT widget, so read it from the root span's attributes
  or the metrics backend — not the per-generation TTFT field, which understates the
  wait on delegate-heavy turns.

## Metrics

Alongside traces the SDK emits (to the OTLP metrics endpoint):

- `gen_ai.client.token.usage` (counter, by model + `gen_ai.token.type`)
- `gen_ai.client.cost.usd` (counter, by model)
- `gen_ai.client.operation.duration` (histogram, seconds)
- `gen_ai.client.turn.time_to_first_token` (histogram, seconds, by model) — user-facing TTFT

Langfuse consumes **traces** and derives its own dashboards; OTLP **metrics** are
supplementary and are best pointed at a Prometheus/collector.

## Cost tracking

`estimateCost` ([src/telemetry/pricing.ts](../src/telemetry/pricing.ts))
holds a per-model USD-per-1M-token table (`gpt-4o`, `gpt-4o-mini`,
`text-embedding-3-small`) and subtracts cached input tokens. Update it when
pricing changes. Langfuse can also compute cost from model + tokens; the explicit
attribute covers backends that don't.

## Configuration

All via env (see [.env.example](../.env.example)); parsed by
[src/telemetry/config.ts](../src/telemetry/config.ts):

| Var                           | Default                                 |
| ----------------------------- | --------------------------------------- |
| `OTEL_ENABLED`                | `false`                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:3000/api/public/otel` |
| `OTEL_EXPORTER_OTLP_HEADERS`  | (empty) — `Authorization=Basic <b64>`   |
| `OTEL_SERVICE_NAME`           | `chat-cli`                              |
| `OTEL_CAPTURE_CONTENT`        | `true`                                  |

## Running Langfuse locally

1. `pnpm infra:start` — brings up Langfuse (`:3000`) plus Postgres, ClickHouse,
   Redis, and a dedicated MinIO alongside the RAG infra.
2. Open <http://localhost:3000>, create an account + project, and copy the project's
   **public** and **secret** keys.
3. Build the auth header and enable telemetry in `.env`:
   ```sh
   echo -n "pk-lf-...:sk-lf-..." | base64
   # OTEL_ENABLED=true
   # OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <that base64>
   ```
4. `pnpm start`, run a turn (bonus: one that delegates and searches the knowledge
   base), then watch the trace tree appear in Langfuse.

To target LangSmith or a generic collector instead, change only the endpoint and
headers — no code changes.
