# CLAUDE.md

## What this is

**chat-cli is a frameworkless AI agent** — a terminal chat app whose agent loop,
context-window management, tool calling, and sub-agent delegation are all
hand-built on the **raw OpenAI SDK**. No LangChain, no agent framework — the sole
LLM dependency in `package.json` is `openai`.

This project exists to expose the machinery frameworks hide — to show what an
agent _actually is_ underneath the magic: a request loop, a token budget, and
tools you wire up yourself. Every layer an agent framework abstracts away is
here in plain sight and under direct control. So favour clarity and correctness
over cleverness, and keep the "frameworkless" claim true — don't introduce an
agent framework or SDK abstraction layer.

Rationale that used to live in inline comments now lives in
[docs/architecture.md](docs/architecture.md); keep source comment-light.

## Three layers

Code is split into three independent layers plus a thin composition root
([src/main.ts](src/main.ts)); dependencies point one way (`ui`/`integration` →
`agent`, never back):

- **`src/agent/`** — the pure core. No filesystem, no Ink, no persistence, no
  config paths. Reusable outside the CLI (e.g. a web server driving the same
  event stream over SSE).
- **`src/ui/`** — the Ink TUI, a thin adapter over the event stream.
- **`src/integration/`** — adapters + wiring: persistence, the OpenAI client, the
  REPL driver, CLI args, file-mentions, and the commands that bridge input to the
  session.

## Key pieces

- **Stateless agent loop** — [src/agent/agent.ts](src/agent/agent.ts):
  `AgentService.run(messages, options, context)` is an async generator that loops
  model → tool-call → tool-result until the model stops asking for tools. It
  works on a local copy of `messages` and **retains nothing** after the loop.
  Independent tool calls run in parallel; a tool that throws becomes an error
  result fed back to the model, never aborting the turn.
- **UI-agnostic event stream** — `run()` yields plain, serializable `TurnEvent`s
  ([events.ts](src/agent/events/events.ts)): presentation events (`delta | tool | status
| answer`) plus `message`/`usage` events by which the stateless agent hands
  transcript + accounting to its caller. The Ink TUI
  ([repl.ts](src/integration/repl.ts) → [chat.tsx](src/ui/chat.tsx)) is a thin
  `for await … switch` adapter. Keep `agent/` free of `ui/` and `integration/`
  imports. A round's concurrent tool/sub-agent generators are fanned into one
  stream by [merge.ts](src/agent/events/merge.ts).
- **Session owns state** — [src/integration/session.ts](src/integration/session.ts):
  holds the transcript, rolling summary, pinned facts, sources, usage totals, and
  context-window management; drives the agent and persists via a
  `ConversationStore` port ([src/integration/store/](src/integration/store/) —
  file now, SQLite/API later).
- **Context management** — last `KEEP_LAST_TURNS` (4) turns kept verbatim; older
  turns fold into a rolling summary via the pure `summarize`
  ([summarizer.ts](src/agent/tokens/summarizer.ts)), invoked by the Session.
- **Prompt caching** — out-of-window state (facts + summary) is appended LAST so
  a `/remember` or re-summarization never invalidates the cached prefix.
- **Sub-agent delegation is just a tool** — `delegate_task`
  ([tools/delegate-task.ts](src/agent/tools/delegate-task.ts)) is a normal registry
  tool; the loop has no delegation-specific branch. Its `execute` uses its
  `ToolRunContext` to `runTurn` a child on the **same** (stateless, re-entrant)
  agent under a fork profile (`FORK_INSTRUCTIONS` + `forkTools`, which exclude
  `delegate_task` to prevent recursion), `yield`s the child's tagged activity, and
  returns a compressed handoff ([handoff.ts](src/agent/tools/utils/handoff.ts)) as
  its output.
- **Tools stream** — Zod-typed, under [src/agent/tools/](src/agent/tools/): a demo
  `get_weather_data`, a keyless Wikipedia-backed `web_search` (forks only, for
  research), and `delegate_task`. Each `execute(args, ctx)` is an async generator
  that `yield`s `TurnEvent`s (progress/sub-agent activity) and returns the output
  string; the agent drains it into the turn's stream. Optional `summarize` yields
  the trace detail. `forkTools` excludes `delegate_task` to prevent recursion.
- **Prompt evals** — behavioural tests of prompts/tools against the live model,
  [evals/](evals/) (evalite). A frameworkless agent's behaviour is its prompts,
  so prompts get tested like code.

## Commands

```bash
pnpm start          # run the TUI
pnpm dev            # file-watch reload
pnpm typecheck      # tsc --noEmit
pnpm lint           # oxlint (fast Rust linter; --fix to autofix)
pnpm format         # oxfmt --write (format:check for CI, no writes)
pnpm test           # unit tests (vitest, model mocked — no API key needed)
pnpm eval           # run prompt evals (needs a real OPENAI_API_KEY)
```

Tests live in [tests/](tests/) (mirroring `src/`), run by
[vitest](vitest.config.ts) — unit tests plus an end-to-end suite
([tests/e2e/](tests/e2e/)) that drives the real REPL flow (`processLine` →
agent loop → tools/forks → chat). All mock the model via
[tests/helpers/mock-openai.ts](tests/helpers/mock-openai.ts) — fast and offline,
distinct from the live-model prompt evals. UI components are tested with
`ink-testing-library`. Not colocated with source (that's a deliberate choice —
`import.meta.vitest` inline testing can't do the `vi.mock` the suite relies on).

Model is `gpt-4o-mini` ([src/agent/config/index.ts](src/agent/config/index.ts)); state
persists to `.chat-state/session.json` via the file store.
