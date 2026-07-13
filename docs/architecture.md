# Architecture

chat-cli is a frameworkless AI agent: the agent loop, context-window management,
tool calling, and sub-agent delegation are hand-built on the raw OpenAI SDK. This
document holds the rationale that used to live in inline comments — the code
itself is kept comment-light.

## The three layers

The codebase is split into three independent layers plus a thin composition root:

```
src/
  agent/         PURE core — the agent loop and everything the model needs.
                 No filesystem, no Ink, no persistence, no config paths.
  ui/            The Ink TUI. Consumes a plain event stream; knows nothing
                 about the agent's internals or storage.
  integration/   Adapters + wiring: persistence, the OpenAI client, the REPL
                 driver, CLI args, file-mention expansion, and the commands
                 that bridge user input to the agent/session.
  store/         Store facade → domain facades (profile, conversation, memory,
                 sources) backed by SQLite via drizzle-orm.
  db/            Schema, migrations, and the SQLite connection.
  main.ts        Composition root: builds every dependency once and hands them
                 to the REPL, so each layer can be driven with test doubles.
```

Dependency direction is one-way: `ui` and `integration` depend on `agent`;
`agent` depends on nothing above it. This is what makes the agent reusable
outside the CLI — a web server could drive the same `AgentService` + `Session`
and forward the same event stream over SSE.

**Frameworkless constraint.** The raw `openai` SDK is used directly inside the
agent (injected, never wrapped). There is deliberately no LLM/SDK abstraction
layer. The only port introduced is for _storage_ (`Store`), which is
not an SDK abstraction.

The one sanctioned exception is `@opentelemetry/api`, imported by the core for
observability. It is an inert API — every call is a no-op until the composition
root registers an SDK — not an LLM/SDK wrapper, and it adds no I/O or state, so the
stateless-core contract holds. See **[observability.md](./observability.md)** for
the span tree, the GenAI semantic-convention attributes, and how spans nest via
per-`.next()` context binding across the loop's async generators.

## The agent loop

`AgentService.run(messages, options, context, profile)`
([src/agent/agent.ts](../src/agent/agent.ts)) is a single-turn **stateless** pure
function: it copies the input, loops model → tool calls → repeat until the model
stops requesting tools, emits a stream of `TurnEvent`s, and retains nothing after
it returns. The agent never touches the `Store`; the Session resolves per-profile
settings before calling `run`.

The full mechanics — the loop steps, the `TurnEvent` contract, tools-as-streams,
**model routing** (orchestrator vs fork vs cheap models, the code-defined
temperature), **memories in context**, and the **generalized sub-agent**
(`delegate_task` / `delegate_tasks`, fork profiles, and the structured
`ForkResult` handoff) — live in **[agent-loop.md](./agent-loop.md)**. The rest of
this document covers everything the agent deliberately does _not_ own: state,
persistence, retrieval infrastructure, and the UI.

## The Session (integration owns state)

`Session` ([src/integration/session.ts](../src/integration/session.ts)) owns
everything the agent does not: pinned memories, indexed sources, token
accounting, the context window, and persistence. It reads all transcript state
from the `Store` on each turn — no in-memory `log`. `runTurn`:

1. appends the user message to the store;
2. loads model input via `queryHistory(conversationId).forModel()` — the full
   unsummarized tail after the latest summary row, with evicted turns replaced by
   the summary text prepended once;
3. resolves the orchestrator `model` from the active profile
   (`userProfile?.model ?? ORCHESTRATOR_MODEL`) into `options` — temperature is a
   code constant, not resolved here (see [agent-loop.md](./agent-loop.md#model-routing));
4. calls `agent.run(messages, options, { memories })`, forwarding presentation
   events to the caller and persisting `message`/`usage` events;
5. compacts the window when the unsummarized tail overflows.

Swapping or extending backends is a new `Store` bundle
([src/store/](../src/store/)); nothing in the agent changes. A future
`CloudStore` might compose API-backed profile/conversation/memory/sources
namespaces — each as its own sub-client on the facade.

### Profiles and conversations

Durable state is split into two scopes:

- **Profile** — a `model` setting plus long-lived memory (`memory`, `source`).
  Memories from `/remember` and paths from `/learn` follow the active profile
  across conversation switches. (Temperature is code-defined, not a per-profile
  setting.)
- **Conversation** — one transcript thread (`conversation_item` rows) under a
  profile. Windowing and token usage are per-conversation.

The top-level `Store` ([src/store/store.ts](../src/store/store.ts)) exposes
`profileId` and `conversationId` via a mutable `StoreContext` that facades
update on switch. On disk, `.chat-state/active.json` remembers the last profile;
each open creates or restores a conversation. `/profile` and `/conversation`
commands open an Ink picker ([src/ui/input/picker-overlay.tsx](../src/ui/input/picker-overlay.tsx))
to switch or create; `applyContextSwitch` rebinds the session, reloads history,
and refreshes the status bar. `pnpm start --conversation <uuid>` skips the picker
and resumes a prior thread directly.

### Context window management

The last `KEEP_LAST_TURNS` (4) user turns are kept verbatim. When the window
overflows, `maintainWindow` splits the unsummarized tail at a user-message
boundary (so tool calls stay attached to their turn), folds the evicted turns
into a rolling summary via the pure `summarize` helper
([src/agent/tokens/summarizer.ts](../src/agent/tokens/summarizer.ts)), and
**appends** a new `kind = 'summary'` row. Older transcript rows remain in the
DB for audit; `queryHistory().afterLastSummary()` excludes them from model
reads. Windowing lives in the Session, not the agent.

### Prompt caching

Pinned memories are appended **last** in the request input via `buildContextBlock`
([src/agent/dynamicContext/context.ts](../src/agent/dynamicContext/context.ts)),
after the conversation prefix. The rolling summary is part of that prefix —
assembled by `forModel()` as a prepended `developer` message replacing evicted
turns, not duplicated in the memories block. A `/remember` changes only the tail
and never invalidates the cached prefix above it. The discretion rules in that
block (telling the model not to volunteer stored memories) are a single source of
truth that the prompt evals exercise directly. Memories are numbered `M1…Mn` so a
delegation can pass a subset — see [agent-loop.md](./agent-loop.md#memories-in-context).

### Token accounting

`usage.ts` ([src/integration/usage.ts](../src/integration/usage.ts)) tracks real
API usage (from the model's `usage` field — never estimated) and a naive
append-everything baseline (estimated via `estimateTokens`, chars/4). The exit
report contrasts the two to show the savings from windowing + caching, charging
the summarizer overhead against the strategy.

## Knowledge base retrieval

The RAG pipeline lives entirely in the `sources` store domain
([src/store/sources/](../src/store/sources/)) behind its facade; the agent core
never learns it exists — it reaches the model only as four store-backed tools.
`/learn @file` runs **ingest** (convert to Markdown → per-profile MinIO bucket →
heading-aware chunking → OpenAI embeddings → per-profile Qdrant collection), and
`search()` runs a four-stage **retrieval** pipeline (hybrid dense+sparse RRF fetch
→ LLM rerank → relative-cutoff filter → return whole chunks) that turns "top-N
regardless of relevance" into "only what's actually relevant". Each chunk carries
its heading breadcrumb and line range, so hits cite `path:startLine-endLine` and
`read_file` slices the exact region.

The full reference — ingest, the retrieval stages and their rationale, the
per-profile infra layout, the four tools, every config knob, and the RAG evals —
lives in **[rag.md](./rag.md)**. Multi-hop retrieval is delegated to the
`rag_research` fork profile; see [agent-loop.md](./agent-loop.md#fork-profiles).

## The UI

The Ink TUI ([src/ui/](../src/ui/)) is a thin adapter over the event stream. The
REPL ([src/integration/repl.ts](../src/integration/repl.ts)) is a
`for await … switch` that maps each presentation event to a `ChatHandle` call.
`chat.tsx` holds the root `Chat` component and the imperative `renderChat`
factory; individual pieces live under `components/`, `hooks/`, and `input/`.

Notable UI details:

- **Alt-screen buffer.** In an interactive TTY the app runs in the terminal's
  alternate screen buffer (like vim/less): `\x1b[?1049h` on launch, `\x1b[?1049l`
  on quit, with a `process.on("exit")` safety net so a crash never leaves the
  terminal stuck. Piped/test runs leave the primary screen untouched.
- **Static vs live.** Finished messages render inside Ink's `<Static>` so they
  are painted once; only the live turn re-renders as tokens stream in.
- **The prompt owns the whole input line** (no readline) so Ink can repaint
  freely. It matches raw control bytes for Ctrl+C/D because terminals disagree on
  whether these arrive with `key.ctrl` set.
- **Exit report** is written straight to fd 1 with `writeSync`, because Ink
  patches `console.log` while mounted and a normal log would be swallowed in the
  unmount/exit race.
- **Context bar.** The usage footer shows the active profile (name, model,
  source/memory counts) and conversation (short id + title). Entity pickers dim
  the chat underneath while open.

## Tests and evals

- `tests/` mirrors `src/` and runs offline with the model mocked
  ([tests/helpers/mock-openai.ts](../tests/helpers/mock-openai.ts)) — fast, no API
  key. Includes an end-to-end suite that drives the real REPL → agent →
  tools/forks path.
- `evals/` holds behavioural prompt evals (evalite) run against the live model.
  A frameworkless agent's behaviour is its prompts, so prompts are tested like
  code.
