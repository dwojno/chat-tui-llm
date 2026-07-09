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
  store/         Store facade → domain facades (profile, conversation, fact,
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

## The stateless agent

`AgentService.run(messages, options, context)` ([src/agent/agent.ts](../src/agent/agent.ts))
is a single-turn pure function. It:

- copies the input `messages` into a local working array and **retains nothing**
  after the loop returns;
- loops model → tool calls → repeat until the model stops requesting tools;
- emits a stream of `TurnEvent`s ([src/agent/events/events.ts](../src/agent/events/events.ts));
- reads `options.model` and `options.temperature` on every API call — the agent
  never touches the `Store`; the Session resolves per-profile overrides before
  calling `run`.

The event vocabulary has two audiences:

- **Presentation** — `delta` (streamed token), `tool` (a tool call started),
  `status` (e.g. a delegation), `answer` (final formatted answer). Any UI
  consumes these via `for await`.
- **Ownership handoff** — `message` (a new transcript item to persist) and
  `usage` (an API usage record, tagged `response` or `summarizer`). Because the
  agent keeps no state, it hands each new transcript item and each usage record
  to its caller through these events.

`MAX_TOOL_STEPS` bounds tool-call rounds per turn; on the final allowed round the
request is re-issued with tools disabled, forcing the model to answer instead of
looping on a tool it keeps re-calling.

Independent tool calls in one round run concurrently; a tool that throws becomes
an error string fed back to the model as a `function_call_output` — the API
rejects a transcript with a dangling `function_call`, and feeding the error back
lets the model recover, so a tool failure never aborts the turn.

### Tools are streams

Every tool's `execute(args, ctx)` is an **async generator**: it `yield`s
`TurnEvent`s as it works and returns its final output string. Plain tools
(weather, web_search) yield nothing and just return; an agentic tool yields
(e.g. a sub-agent's activity).

A round of tool calls runs concurrently, so the loop hands all their generators
to `mergeGenerators` ([src/agent/events/merge.ts](../src/agent/events/merge.ts)),
which uses [`it-merge`](https://www.npmjs.com/package/it-merge) to interleave
events:

```ts
const { events, results } = mergeGenerators(calls.map((call) => this.executeCall(call, context)));
for await (const event of events) {
  yield event;
}
const outputs = await results;
```

`mergeGenerators` drives tool generators concurrently, streams their events
interleaved as they arrive, and resolves outputs in input order (each becomes a
`function_call_output`). A thin bridge adapter captures each generator's return
value — `it-merge` only merges yielded values. There is no `emit` callback and
no per-tool special case in the loop — every call is treated the same way.

## The Session (integration owns state)

`Session` ([src/integration/session.ts](../src/integration/session.ts)) owns
everything the agent does not: pinned facts, indexed sources, token accounting,
the context window, and persistence. It reads all transcript state from the
`Store` on each turn — no in-memory `log`. `runTurn`:

1. appends the user message to the store;
2. loads model input via `queryHistory(conversationId).forModel()` — the full
   unsummarized tail after the latest summary row, with evicted turns replaced by
   the summary text prepended once;
3. resolves `options.model` and `options.temperature` from the active profile
   (falling back to `MODEL` and `DEFAULT_TURN_OPTIONS.temperature`);
4. calls `agent.run(messages, options, { facts })`, forwarding presentation
   events to the caller and persisting `message`/`usage` events;
5. compacts the window when the unsummarized tail overflows.

Swapping or extending backends is a new `Store` bundle
([src/store/](../src/store/)); nothing in the agent changes. A future
`CloudStore` might compose API-backed profile/conversation/fact/sources namespaces
— each as its own sub-client on the facade.

### Profiles and conversations

Durable state is split into two scopes:

- **Profile** — settings (`model`, `temperature`) plus long-lived memory
  (`fact`, `source`). Facts from `/remember` and paths from `/learn` follow the
  active profile across conversation switches.
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

Pinned facts are appended **last** in the request input via `buildContextBlock`
([src/agent/dynamicContext/context.ts](../src/agent/dynamicContext/context.ts)),
after the conversation prefix. The rolling summary is part of that prefix —
assembled by `forModel()` as a prepended `developer` message replacing evicted
turns, not duplicated in the facts block. A `/remember` changes only the tail
and never invalidates the cached prefix above it. The discretion rules in that
block (telling the model not to volunteer stored facts) are a single source of
truth that the prompt evals exercise directly.

### Token accounting

`usage.ts` ([src/integration/usage.ts](../src/integration/usage.ts)) tracks real
API usage (from the model's `usage` field — never estimated) and a naive
append-everything baseline (estimated via `estimateTokens`, chars/4). The exit
report contrasts the two to show the savings from windowing + caching, charging
the summarizer overhead against the strategy.

## Sub-agent delegation

Delegation is **just another tool**. `delegate_task`
([src/agent/tools/delegate-task.ts](../src/agent/tools/delegate-task.ts)) is a
normal registry tool — the agent loop has no delegation-specific code. Its
`execute` owns the whole sub-agent flow, using its `ToolRunContext`:

- `ctx.runTurn(...)` **reuses the same agent** to run one child turn under a fork
  profile — focused `FORK_INSTRUCTIONS`, `forkTools` (which exclude
  `delegate_task`, preventing recursion), and a fresh per-fork cache key. Safe
  because `run` is stateless and re-entrant: each invocation keeps its own local
  working transcript, so a nested delegated turn can't disturb the outer one. The
  profile is the optional last argument to `run`, defaulting to the main profile.
- The tool collects the child transcript locally, compresses it into a short
  handoff ([src/agent/tools/utils/handoff.ts](../src/agent/tools/utils/handoff.ts)), and returns that as
  its tool output (a normal `function_call_output` — no special transcript
  injection).
- It `yield`s the child's tool/status activity tagged with the delegation's title
  (via the `fork` field) so a UI can nest it, and yields its usage records; the
  child's answer tokens stay internal — the result is the digest.

Several delegations in one round run in parallel, like any other tool.

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
  source/fact counts) and conversation (short id + title). Entity pickers dim the
  chat underneath while open.

## Tests and evals

- `tests/` mirrors `src/` and runs offline with the model mocked
  ([tests/helpers/mock-openai.ts](../tests/helpers/mock-openai.ts)) — fast, no API
  key. Includes an end-to-end suite that drives the real REPL → agent →
  tools/forks path.
- `evals/` holds behavioural prompt evals (evalite) run against the live model.
  A frameworkless agent's behaviour is its prompts, so prompts are tested like
  code.
