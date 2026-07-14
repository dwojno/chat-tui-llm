# chat-cli

**A frameworkless AI agent in your terminal.** The agent loop, context-window
management, tool calling, and sub-agent delegation are all hand-built on the raw
OpenAI SDK — no LangChain, no agent framework, nothing hiding the mechanics. Streaming
replies land in an [Ink](https://github.com/vadimdemedes/ink) (React) TUI.

The whole design in one line: **the agent is a pure reducer over an owned, serializable
event log.** That single idea gives full control of every token, a stateless core, and
self-healing tool use — all the machinery a framework hides, here in plain sight.

<p align="center">
  <img src="docs/demo.gif" alt="chat-cli in action: a streamed answer, a live tool-call trace, and a delegated sub-agent" width="800">
</p>

<sub>Demo recorded with [VHS](https://github.com/charmbracelet/vhs) — run `vhs demo.tape` to regenerate [`docs/demo.gif`](docs/demo.gif).</sub>

## The core idea

A turn is a fold: reduce the history you own into an input, ask the model for one
decision, append the result, repeat.

```
 events ──▶ reduce(events) ──▶ ONE custom-format <user> message ──▶ Agent.step ──▶ tool calls
(state)      └ owned format       <get_weather>intent:…</get_weather>   └ pure      or text
   ▲                                                                                   │
   └──────────────────── append AgentEvent ◀── run tools / answer ◀────────────────────┘
```

- **Pure-function agent** — `Agent.step()` is _one_ model call, `executeTool()` is _one_ dispatch. No loop, no retained state, no config/prompt imports — the whole core is a pure function of its injected deps. [`agent/agent.ts`](src/agent/agent.ts)
- **Own the context window** — a reducer folds the event log into a single XML-tagged, YAML-bodied `<user>` message instead of a raw role array. Every token is deliberate; ordering keeps the prompt cache warm. [`runner/thread/reducer.ts`](src/runner/thread/reducer.ts)
- **The log is the state** — the append-only `AgentEvent` log _is_ the entire turn state. The core keeps nothing between turns, so a run is resumable by construction (pause/resume + trigger-anywhere are clean seams). [`runner/thread/events.ts`](src/runner/thread/events.ts)
- **Compact errors → self-heal** — a tool failure becomes a compact `error` event fed back to the model; resolved errors are pruned from the window, and repeated failures escalate to a human instead of spinning. [`runner/runner.ts`](src/runner/runner.ts)
- **Own the control flow** — `runAgentLoop` is a plain async function you can read top to bottom. It keeps **native** tool-calling (several tools per turn, in parallel; token-streamed answers) and layers in reserved control intents (`done_for_now`, `request_more_information`) it interprets by name. [`runner/runner.ts`](src/runner/runner.ts)

The EventBus that streams a turn to the UI is **never persisted** — durable state is the
returned event log. A web server could drive the same `Agent` and forward the bus over
SSE. See [docs/agent-loop.md](docs/agent-loop.md) for the full mechanics.

## Also

- **Context-window management** — last 4 turns kept verbatim; older turns fold into a rolling summary and drop out, preserving a stable, cacheable prompt prefix. Owned by the session, not the agent. [`tokens/summarizer.ts`](src/tokens/summarizer.ts)
- **Sub-agent delegation** — the model spins up ephemeral child agents (several in parallel), each with its own context, tools, and model, handing back a compressed structured digest. Their tool activity streams back live under a model-chosen label. [`tools/delegation/`](src/tools/delegation/)
- **Injected tools** — the core ships _zero_ tools; the host composes a main set + fork sets as one `ToolDefinition` type. Built-ins: weather + a web search; compose your own in [`src/tools/`](src/tools/).
- **Knowledge base (RAG)** — `/learn @file` converts a source (md/txt/code, PDF, DOCX, HTML, XLSX, CSV) → a per-profile blob store (local disk by default, MinIO/S3 optional) → heading-aware chunks → per-profile Qdrant collection, indexed with **hybrid dense+sparse search fused via RRF**, then an **LLM reranker** keeps only on-topic passages (returned whole, with `path:line` cites). Lives entirely in the `sources` store domain; the core stays RAG-agnostic. [`store/sources/`](src/store/sources/)
- **Observability** — OpenTelemetry (GenAI semantic conventions) → OTLP; the full turn → LLM-call → tool → fork span tree with token/cost. Off by default, vendor-neutral. [docs/observability.md](docs/observability.md)
- **Structured output**, **prompt evals** against the live model ([evals/](evals/)), and a fast **offline test suite** (model mocked; unit + e2e) covering the loop, tool failures, delegation, and the reducer. [tests/](tests/)

## Setup

```bash
pnpm install
echo "OPENAI_API_KEY=sk-..." > .env
pnpm start
```

- `pnpm dev` — file-watch reload · `pnpm typecheck` · `pnpm test` (offline, no key) · `pnpm eval` (live model)

### Knowledge base (RAG) services

`/learn` needs Qdrant for vector search; the converted-Markdown blobs default to local
disk (`.chat-state/sources/`), so nothing else is required. Start the infra and copy
the RAG env:

```bash
pnpm infra:start       # Qdrant :6333 + Langfuse stack (:3000, observability)
cp .env.example .env   # then set OPENAI_API_KEY; defaults point at localhost
```

`pnpm infra:stop` keeps data; `pnpm infra:clear` wipes volumes. Defaults (endpoints,
models, chunk sizes) live in [`.env.example`](.env.example); each profile gets its own
blob namespace and Qdrant collection (`kb_<profile>`). Set `RAG_BLOB_BACKEND=s3` to
store blobs in MinIO/S3 (per-profile bucket `chat-cli-<profile>`) instead. The test
suite fakes these; to hit the real ones: `RAG_INTEGRATION=1 pnpm test tests/store/rag/live.integration.test.ts`.

## Usage

```bash
pnpm start                            # fresh conversation
pnpm start -- --conversation <uuid>   # -c for short; resume a previous one
```

At the `>` prompt, type a message for a streaming reply, or use a command:

| Command                 | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `/remember <memory>`    | Pin a memory; injected into every later turn (survives truncation) |
| `/learn @file [@…]`     | Convert, upload, chunk, embed and index files for RAG              |
| `/sources` · `/reindex` | List / re-index the files indexed in the current profile           |
| `/profile`              | Switch or create a profile — own bucket, collection + memory       |
| `/conversation`         | Switch or start a chat thread within the current profile           |
| `/json` · `/structured` | Reply in JSON mode / validated against a Zod schema                |
| `exit`                  | Leave the REPL (Ctrl+C / Ctrl+D also work)                         |

Prefix a path with `@` in any message to inline a file into the turn (sandboxed to the
working dir, binaries skipped, size-capped). On exit, a token-savings report contrasts
actual input tokens against a naive "re-send everything" baseline — the payoff of the
context management above.

## Structure

```
src/
  agent/       PURE core — Agent.step()/executeTool() + tool/event contracts. No loop, no state.
  runner/      the caller-owned loop (runner.ts) + the reducer (thread/: events, reducer, window, convert)
  tools/       tool implementations — weather, web-search, disk, rag, delegation, control intents
  integration/ Session (state + persistence), context switch, usage
  store/        store facade → profile / conversation / memory / sources; sources/ owns the RAG pipeline
  tokens/       rolling summarizer + token estimation
  ui/  input/  cli/   Ink TUI · REPL loop · CLI boot
  db/           SQLite connection, schema, migrations
tests/   evals/   docs/
```

See [docs/architecture.md](docs/architecture.md) for how the layers fit together,
[docs/agent-loop.md](docs/agent-loop.md) for the turn/reducer/delegation mechanics, and
[docs/rag.md](docs/rag.md) for the knowledge-base pipeline.
