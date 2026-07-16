<div align="center">

# chat-cli

**A frameworkless AI agent in your terminal.**

The agent loop, context-window management, tool calling, and sub-agent delegation are
all hand-built on the raw OpenAI SDK — no LangChain, no agent framework, nothing hiding
the mechanics. Streaming replies land in an [Ink](https://github.com/vadimdemedes/ink)
(React) TUI.

<br>

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAI SDK](https://img.shields.io/badge/OpenAI_SDK-the_only_LLM_dep-412991?logo=openai&logoColor=white)](https://github.com/openai/openai-node)
[![Ink + React 19](https://img.shields.io/badge/Ink_+_React_19-TUI-61DAFB?logo=react&logoColor=black)](https://github.com/vadimdemedes/ink)
[![Zod](https://img.shields.io/badge/Zod-schemas-3E67B1)](https://zod.dev/)
[![Drizzle + SQLite](https://img.shields.io/badge/Drizzle_+_SQLite-persistence-C5F74F?logo=sqlite&logoColor=black)](https://orm.drizzle.team/)
[![Vitest](https://img.shields.io/badge/Vitest-offline_suite-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
![License](https://img.shields.io/badge/license-ISC-blue)

<br>

[![Qdrant](https://img.shields.io/badge/Qdrant-vector_search-DC244C?logo=qdrant&logoColor=white)](https://qdrant.tech/)
[![MinIO / S3](https://img.shields.io/badge/MinIO_/_S3-blob_store-C72E48?logo=minio&logoColor=white)](https://min.io/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-traces-425CC7?logo=opentelemetry&logoColor=white)](https://opentelemetry.io/)
[![Langfuse](https://img.shields.io/badge/Langfuse-OTLP_backend-0A0A0A)](https://langfuse.com/)

<br>

<img src="docs/demo.gif" alt="chat-cli in action: a streamed answer, a live tool-call trace, and a delegated sub-agent" width="820">

<sub>Demo recorded with <a href="https://github.com/charmbracelet/vhs">VHS</a> — run <code>vhs demo.tape</code> to regenerate <a href="docs/demo.gif"><code>docs/demo.gif</code></a>.</sub>

</div>

---

## The core idea

The whole design in one line: **the agent is a pure reducer over an owned, serializable
event log.** That single idea buys full control of every token, a stateless core, and
self-healing tool use — all the machinery a framework hides, here in plain sight.

A turn is a fold: reduce the history you own into an input, ask the model for one
decision, append the result, repeat.

```
 events ──▶ reduce(events) ──▶ ONE custom-format <user> message ──▶ Agent.step ──▶ tool calls
(state)      └ owned format       <get_weather>intent:…</get_weather>   └ pure      or text
   ▲                                                                                   │
   └──────────────────── append AgentEvent ◀── run tools / answer ◀────────────────────┘
```

**What the model actually sees** is not a role array. The reducer folds the whole event
log into one XML-tagged `<user>` message — four blocks, in a fixed order:

```
   the owned AgentEvent log  ──reduce()──▶  a single <user> message

   <events>
     <conversation_summary> …older turns, rolled up… </conversation_summary>
     <user_message> what's the weather in NYC? </user_message>
     <get_weather> intent: get_weather, city: NYC </get_weather>
     <get_weather_result> sunny, 72°F </get_weather_result>
     <assistant_answer> It's 72°F and sunny in NYC. </assistant_answer>
   </events>
   <context>    …memories M1…Mn, numbered, with rules for using them… </context>
   <scratchpad>  …the agent's private plan / findings… </scratchpad>
   <next_step>   choose the next step: call tools, ask, or answer </next_step>
```

- **Every event becomes one block.** A tool call renders as `<get_weather>`, its result as
  `<get_weather_result>`, a failure as `<error>` — the log's event types map straight to
  tags. [`app/runner/thread/reducer.ts`](src/app/runner/thread/reducer.ts)
- **Ordering _is_ the cache strategy.** `<events>` is append-only, oldest → newest, with
  resolved errors pruned — a prefix that stays byte-identical turn to turn. Memories,
  scratchpad, and `next_step` form a volatile tail, so a `/remember` or a scratchpad edit
  never invalidates the cached prefix above it.

The EventBus that streams a turn to the UI is **never persisted** — durable state is the
returned event log. A web server could drive the same `Agent` and forward the bus over
SSE. See [docs/agent-loop.md](docs/agent-loop.md) for the full mechanics.

## Highlights

### A pure core, an owned loop

Two pure primitives, no retained state — the loop lives in the host, readable top to bottom:

```ts
// src/agent — the entire core. No loop, no state, no config/prompt imports.
step(input)        →  assistant text | tool calls     // ONE model call, streams deltas
executeTool(call)  →  result                          // ONE dispatch

// the loop is a plain async function in the host:
while (!done && steps++ < MAX_TOOL_STEPS) {
  const decision = await agent.step(reduce(log))      // fold the log → ask the model
  log.push(decision)                                  // append
  if (decision.toolCalls)                             // run tools, fanned out
    log.push(...await Promise.all(decision.toolCalls.map(agent.executeTool)))
}
```

- **Pure-function agent** — `step()` and `executeTool()` are pure functions of their injected
  deps; the core imports nothing outward and keeps nothing between turns.
  [`agent/agent.ts`](src/agent/agent.ts)
- **The log is the state** — the append-only `AgentEvent` log _is_ the turn state, so a run is
  resumable by construction (pause/resume + trigger-anywhere are clean seams).
  [`app/runner/thread/events.ts`](src/app/runner/thread/events.ts)
- **Own the control flow** — `runAgentLoop` keeps **native** tool-calling (several tools per
  turn, in parallel; token-streamed answers) and layers in reserved control intents
  (`done_for_now`, `request_more_information`) it interprets by name.
  [`app/runner/runner.ts`](src/app/runner/runner.ts)

### Context that manages itself

```
turns:  1  2  3  4  5 … 26 27 28 29 30   (newest)
        └──── folded into a summary ───┘ └── last 4 kept verbatim ──┘
        summary + recent turns  =  a stable, cacheable prompt prefix
```

- **Context-window management** — older turns fold into a rolling summary and drop out; the
  last 4 stay verbatim. Owned by the session, not the agent.
  [`app/tokens/summarizer.ts`](src/app/tokens/summarizer.ts)

### Self-healing tool use

```
tool throws ─▶ compact <error> event ─▶ fed back to the model ─▶ it adjusts, retries
                                                                     │
                          resolved? the <error> is pruned  ◀─────────┘
                          3 failures in a row? ─▶ escalate to a human, don't spin
```

- A failure never crashes the turn — it becomes context the model can recover from, with a
  hard backstop on repeated errors. [`app/runner/runner.ts`](src/app/runner/runner.ts)

### Sub-agent delegation

```
orchestrator
  └─ delegate_tasks ─┬─▶ fork: "research prices"    ┐ each fork: its own
     (Promise.all,   ├─▶ fork: "check the weather"  │ context, tools & model
      up to 6)       └─▶ fork: "read the docs"      ┘
                           │
       each fork transcript ─▶ compressHandoff ─▶ { findings }  ← only the digest
                                                                  re-enters the parent
```

- **Ephemeral child agents** run in parallel and hand back a compressed structured digest;
  their tool activity streams back live under a model-chosen label.
  [`app/tools/delegation/`](src/app/tools/delegation/)

### Knowledge base (RAG)

```
/learn @file ─▶ convert (pdf·docx·html·xlsx·csv·md·code) ─▶ heading-aware chunks
             ─▶ embed ─▶ Qdrant collection (per profile)

query ─▶ dense + sparse search ─▶ RRF fuse ─▶ LLM rerank ─▶ whole passages + path:line cites
```

- **Hybrid retrieval, reranked** — dense + sparse vectors fused via RRF, then an LLM reranker
  keeps only on-topic passages. Lives entirely in the `sources` store domain; the core stays
  RAG-agnostic. [`store/sources/`](src/store/sources/)

### Observability & tests

```
turn ───────────────────── tokens · cost
├─ llm.call
├─ tool: get_weather
└─ fork: "research"
   ├─ llm.call
   └─ tool: web_search
```

- **Observability** — OpenTelemetry (GenAI semantic conventions) → OTLP; the full
  turn → LLM-call → tool → fork span tree with token/cost. Off by default, vendor-neutral.
  [docs/observability.md](docs/observability.md)
- **Structured output**, **prompt evals** against the live model ([evals/](evals/)), and a
  fast **offline test suite** (model mocked; unit + e2e) covering the loop, tool failures,
  delegation, and the reducer. [tests/](tests/)

## Quick start

```bash
pnpm install
brew install just     # task runner; every task other than `start` is a just recipe
echo "OPENAI_API_KEY=sk-..." > .env
pnpm start
```

`just --list` shows every recipe — `just dev` (file-watch reload), `just typecheck`,
`just test` (offline, no key), `just eval` (live model), `just check` (the pre-commit
gate). The knowledge-base tools need Qdrant and a little more setup — see
[docs/rag.md](docs/rag.md).

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

## Architecture

Imports use the `@/*` alias (→ `src/*`), so an import path mirrors this tree.
Three core PILLARS + a MIDDLE integrator (`app/`) + leaf INFRA (`platform/`):

```
src/
  agent/       PILLAR — PURE core: Agent.step()/executeTool() + tool/event contracts. No loop, no state.
  store/       PILLAR — store facade → profile / conversation / memory / sources (RAG); db/ backs it.
  ui/          PILLAR — Ink TUI, driven by an EventBus subscription.
  app/         MIDDLE — integrator + configurator that wires the pillars into a working agent:
    runner/      the caller-owned loop (runner.ts) + reducer (thread/: events, reducer, window, convert)
    session/     Session (state + persistence), context switch, usage
    tools/       tool implementations — weather, web-search, disk, rag, delegation, control intents
    commands/    user-intent handlers · input/ REPL loop · context/ memory block · tokens/ summarizer
    config.ts prompts.ts   app constants + orchestrator system prompt
  platform/    INFRA — telemetry · utils · cli boot (leaf, used everywhere)
  main.ts cli.ts   composition root + entry
tests/   evals/   docs/
```

Dig deeper:

- [docs/architecture.md](docs/architecture.md) — how the layers fit together
- [docs/agent-loop.md](docs/agent-loop.md) — the turn / reducer / delegation mechanics
- [docs/rag.md](docs/rag.md) — the knowledge-base pipeline and its services
- [docs/database.md](docs/database.md) — persistence, schema, migrations
- [docs/evals.md](docs/evals.md) — live-model prompt evals
- [docs/observability.md](docs/observability.md) — the OpenTelemetry span tree
- [docs/security.md](docs/security.md) - security of the cli
