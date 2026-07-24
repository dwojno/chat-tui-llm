# Architecture

chat-cli is a frameworkless AI agent: the agent loop, context-window management,
tool calling, and sub-agent delegation are hand-built on the raw OpenAI SDK. This
document holds the rationale that used to live in inline comments — the code
itself is kept comment-light.

## The layers

Reusable modules live under `packages/`; the deployable terminal host lives under
`apps/cli`. Package dependencies point inward toward `@chat/agent`, while the CLI
composition root wires the package interfaces to its UI and local backend.

```
packages/
  agent/         Pure core: step/executeTool, tool/event/HITL contracts.
  engine/        Model→tool→result loop, reducer, windowing, scratchpad.
  tools/         Disk, web, RAG, MCP, and delegation tool implementations.
  platform/      Model adapter, telemetry, resilience, and shared utilities.
  store/         Persistence contract and domain value types only.
apps/cli/src/
  backend/       SQLite LocalStore, repositories, migrations, and RAG infrastructure.
  commands/      User-intent handlers.
  context/       Assembles the <user_known_memories> block.
  input/         REPL input and file mentions.
  session/       Session state, context switching, and usage reporting.
  ui/            Ink TUI.
  args.ts        CLI argument parsing.
  config.ts      Unified models, limits, paths, and environment parsing.
  prompts.ts     CLI system prompt.
  shutdown.ts    Exit report and cleanup.
  main.ts        Composition root.
  cli.ts         Process entry point and telemetry lifecycle.
```

The CLI uses `@/*` for its own `src/`; cross-package imports use `@chat/*`. This is
what makes the agent reusable outside the CLI — another host can construct the same
`Agent`, reuse `runAgentLoop`, and expose the event stream through its own UI.

**Frameworkless constraint.** The raw `openai` SDK is used directly inside the
agent (injected, never wrapped). There is deliberately no LLM/SDK abstraction
layer. The only port introduced is for _storage_ (`Store`), which is
not an SDK abstraction.

The one sanctioned exception is `@opentelemetry/api`, imported by the core for
observability. It is an inert API — every call is a no-op until the composition
root registers an SDK — not an LLM/SDK wrapper, and it adds no I/O or state, so the
stateless-core contract holds. See **[observability.md](./observability.md)** for
the span tree, the GenAI semantic-convention attributes, and how spans nest via the
ambient OTel context that `AsyncLocalStorage` propagates across `await`s.

## The agent primitives and the loop

The core idea: **the agent is a pure reducer over an owned, serializable event
log**. A turn is a fold — `reduce(events) → prompt`, ask the model for one decision,
append the result event, repeat.

The `Agent` ([packages/agent/src/agent.ts](../packages/agent/src/agent.ts)) exposes two **stateless,
pure** primitives and owns no loop: `step()` makes one model call (streaming `delta`
to the injected `EventBus`) and returns `{ outputText, outputParsed, toolCalls,
usage }`; `executeTool()` dispatches one tool call. Every collaborator and constant is
injected — the agent imports no config, prompt, or event type, and never touches the
`Store`.

The **loop** lives in the caller: `runAgentLoop`
([packages/engine/src/runner.ts](../packages/engine/src/runner.ts)) folds an owned `AgentEvent[]` log
into one custom-format prompt (the **reducer**, [packages/engine/src/thread/](../packages/engine/src/thread/)),
calls `step`, runs the approval gate, executes tools with `Promise.all`, appends the
resulting events, and **returns** `{ answer, events, usage }`. The **`EventBus` is
UI-only and never persisted**; the durable state is the event log. A few design
principles fall out of this shape: the reducer **owns the context window** (a
custom-format prompt, not a default role array), one event log is the **entire turn
state**, the runner **owns the control flow** (a plain function, not a framework),
tool failures are **compacted into context** so the model self-heals, and the core is
a **stateless reducer** that retains nothing — which makes pause/resume and
trigger-from-anywhere clean seams, because the log _is_ the resumable state.

The full mechanics — the reducer + custom context format, the hybrid loop (native
tool-calling + reserved control intents), compact-error self-healing, the `TurnEvent`
contract, **model routing**, **memories in context**, and the **generalized sub-agent**
(`delegate_task` / `delegate_tasks`, fork profiles, the structured `ForkResult`
handoff) — live in **[agent-loop.md](./agent-loop.md)**. The rest of this document
covers everything the agent deliberately does _not_ own: state, persistence,
retrieval infrastructure, and the UI.

## The Session

`Session` ([apps/cli/src/session/session.ts](../apps/cli/src/session/session.ts)) owns
everything the agent does not: pinned memories, indexed sources, token
accounting, the context window, and persistence. It reads all transcript state
from the `Store` on each turn — no in-memory `log`. `runTurn`:

1. appends the user message to the store as a `user_message` event;
2. loads the model window via `queryHistory(conversationId).forModel()` — the
   `AgentEvent[]` of every summary segment plus the messages after the last one
   (summaries are `summary` events in the log, not a side channel);
3. resolves the orchestrator `model` from the active profile
   (`userProfile?.model ?? ORCHESTRATOR_MODEL`) into `options` — temperature is a
   code constant, not resolved here (see [agent-loop.md](./agent-loop.md#model-routing));
4. calls `runAgentLoop({ agent, events, options, context: { memories }, bus, … })`,
   then persists the returned `events` + `usage` in one transaction and returns the
   `answer` (the UI observes `delta`/`tool`/`status` live via the injected bus);
5. compacts the window when the unsummarized tail overflows (folds it into a new
   `summary` segment — see [agent-loop.md](./agent-loop.md#windowing)).

Swapping or extending backends is a new `Store` implementation; the CLI's is under
([apps/cli/src/backend/](../apps/cli/src/backend/)). Nothing in the agent changes. A future
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

The top-level `Store` ([apps/cli/src/backend/store.ts](../apps/cli/src/backend/store.ts)) exposes
`profileId` and `conversationId` via a mutable `StoreContext` that facades
update on switch. On disk, `.chat-state/active.json` remembers the last profile;
each open creates or restores a conversation. `/profile` and `/conversation`
commands open an Ink picker ([apps/cli/src/ui/input/picker-overlay.tsx](../apps/cli/src/ui/input/picker-overlay.tsx))
to switch or create; `applyContextSwitch` rebinds the session, reloads history,
and refreshes the status bar. `pnpm start --conversation <uuid>` skips the picker
and resumes a prior thread directly.

### Context window management

When the un-summarized tail exceeds `KEEP_LAST_TURNS` (4) user turns, `maintainWindow`
folds the **whole tail** into one `summary` segment via the pure `summarize` helper
([packages/engine/src/tokens/summarizer.ts](../packages/engine/src/tokens/summarizer.ts)) and **appends** it as a new
`kind = 'summary'` event. Segments are never rewritten; `queryHistory().forModel()`
returns every segment plus the messages after the last one, so evicted turns are
represented (never dropped) — see [agent-loop.md](./agent-loop.md#windowing). Windowing
lives in the Session, not the agent.

### Prompt caching

The reducer ([packages/engine/src/thread/reducer.ts](../packages/engine/src/thread/reducer.ts)) packs
one `user` message ordered **events → memories → next-step framing**, where the event
list itself leads with the `summary` segments. Segments change only when a new one is
minted, messages are append-only, and pinned memories go **last** so a `/remember`
changes only the tail and never invalidates the cached prefix above it. Rendering is deterministic (no ids/timestamps
in the text), so the leading token run is byte-stable step to step and
`prompt_cache_key` keeps paying off. The discretion rules in that
block (telling the model not to volunteer stored memories) are a single source of
truth that the prompt evals exercise directly. Memories are numbered `M1…Mn` so a
delegation can pass a subset — see [agent-loop.md](./agent-loop.md#memories-in-context).

### Token accounting

`usage.ts` ([apps/cli/src/session/usage.ts](../apps/cli/src/session/usage.ts)) tracks real
API usage (from the model's `usage` field — never estimated) and a naive
append-everything baseline (estimated via `estimateTokens`, chars/4). The exit
report contrasts the two to show the savings from windowing + caching, charging
the summarizer overhead against the strategy.

## Knowledge base retrieval

The RAG pipeline lives entirely in the CLI backend's `sources` domain
([apps/cli/src/backend/sources/](../apps/cli/src/backend/sources/)) behind its facade; the agent core
never learns it exists — it reaches the model only as four store-backed tools.
`/learn @file` runs **ingest** (convert to Markdown → per-profile blob store (local
disk by default, MinIO/S3 optional) → heading-aware chunking → OpenAI embeddings →
per-profile Qdrant collection), and
`search()` runs a four-stage **retrieval** pipeline (hybrid dense+sparse RRF fetch
→ LLM rerank → relative-cutoff filter → return whole chunks) that turns "top-N
regardless of relevance" into "only what's actually relevant". Each chunk carries
its heading breadcrumb and line range, so hits cite `path:startLine-endLine` and
`read_source` slices the exact region.

The full reference — ingest, the retrieval stages and their rationale, the
per-profile infra layout, the four tools, every config knob, and the RAG evals —
lives in **[rag.md](./rag.md)**. Multi-hop retrieval is delegated to the
`rag_research` fork profile; see [agent-loop.md](./agent-loop.md#fork-profiles).

## MCP servers

The agent can use tools exposed by external **MCP** (Model Context Protocol)
servers — both remote **HTTP** servers and locally-launched **stdio** servers (e.g.
a scraping or browser-automation server). A single client
([packages/tools/src/mcp/](../packages/tools/src/mcp/), built on `@modelcontextprotocol/sdk`)
connects to each server at boot, lists its tools, and wraps every one as an ordinary
local `ToolDefinition` whose `execute` proxies to `client.callTool`. Because the wrap
produces a plain tool, the runner loop, approval gate, and dispatch registry work on
MCP tools unchanged — MCP tools are marked `requiresApproval` (they run browsers /
spawn processes) and carry the server's JSON Schema verbatim via `rawParameters`
(with `strict: false`, since arbitrary MCP schemas don't meet OpenAI strict mode).

We deliberately do **not** use the Responses API's native `tools:[{type:"mcp"}]`:
that executes server-side and can only reach HTTP endpoints, so it cannot drive a
local stdio process like Playwright. One unified client covers both transports.

Servers are configured **per profile** (`mcp_server` table, `store.mcp` facade),
managed with the interactive **`/mcp`** modal (a picker to add / enable / disable /
remove, built from the existing `pickEntity` + `promptInModal` primitives); there are no
servers by default. Changes take effect on the **next start** — the tool registry
is built once at boot. Connecting runs by default; since a fresh profile has no servers,
the offline test suite spawns nothing (and `run({ disableMcp: true })` skips it outright).

## The UI

The Ink TUI ([apps/cli/src/ui/](../apps/cli/src/ui/)) is a thin adapter over the event stream. The
REPL ([apps/cli/src/input/repl.ts](../apps/cli/src/input/repl.ts)) subscribes to the `EventBus` and
maps each event (`delta`/`tool`/`status`/`approval_*`) to a `ChatHandle` call, then
commits the answer returned by `Session.runTurn`.
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

- `apps/cli/tests/` mirrors the CLI app and runs offline with the model mocked
  ([apps/cli/tests/helpers/mock-openai.ts](../apps/cli/tests/helpers/mock-openai.ts)) — fast, no API
  key. Includes an end-to-end suite that drives the real REPL → agent →
  tools/forks path.
- `apps/cli/evals/` holds behavioural prompt evals (evalite) run against the live model.
  A frameworkless agent's behaviour is its prompts, so prompts are tested like
  code.
