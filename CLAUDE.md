# CLAUDE.md

## What this is

**chat-cli is a frameworkless AI agent** — a terminal chat app whose agent loop,
context-window management, tool calling, and sub-agent delegation are all
hand-built on the **raw OpenAI SDK**. No LangChain, no agent framework — the sole
LLM dependency in `package.json` is `openai`.

This project exists to expose the machinery frameworks hide — to show what an
agent *actually is* underneath the magic: a request loop, a token budget, and
tools you wire up yourself. Every layer an agent framework abstracts away is
here in plain sight and under direct control. So favour clarity and correctness
over cleverness, and keep the "frameworkless" claim true — don't introduce an
agent framework or SDK abstraction layer.

## Key pieces

- **Agent loop** — [src/conversation/service.ts](src/conversation/service.ts):
  `run(prompt)` is an async generator that loops model → tool-call →
  tool-result until the model stops asking for tools, then yields the answer.
  Independent tool calls in one turn run in parallel; a tool that throws/rejects
  becomes an error result fed back to the model, never aborting the turn.
- **UI-agnostic event stream** — `run()` yields plain, serializable `TurnEvent`s
  ([events.ts](src/conversation/events.ts): `delta | tool | status | answer`) —
  no callbacks, no UI types. The Ink TUI ([repl.ts](src/cli/repl.ts) →
  [chat.tsx](src/ui/chat.tsx)) is a thin `for await … switch` adapter; a future
  web UI would consume the same stream over SSE. Keep `service.ts` free of
  `ui/` imports. Concurrent sub-agent events merge in via
  [event-queue.ts](src/conversation/event-queue.ts).
- **Context management** — last `KEEP_LAST_TURNS` (4) turns kept verbatim; older
  turns fold into a rolling summary ([summarizer.ts](src/conversation/summarizer.ts)).
- **Prompt caching** — out-of-window state (facts + summary) is appended LAST so
  a `/remember` or re-summarization never invalidates the cached prefix.
- **Sub-agent delegation** — `delegate_task` forks ephemeral child agents
  ([fork.ts](src/conversation/fork.ts)) — several can run in parallel — each
  folding a compressed handoff ([handoff.ts](src/conversation/handoff.ts)) back
  into the main thread. `runFork` is itself a generator: the child's tool
  activity streams up tagged with the delegation's short model-chosen `title`.
- **Tools** — Zod-typed, under [src/tools/](src/tools/): a demo `get_weather_data`,
  a keyless Wikipedia-backed `web_search` (forks only, for research), and
  `delegate_task`. Each tool's optional `summarize` yields the trace detail;
  `forkTools` excludes `delegate_task` to prevent recursion.
- **Prompt evals** — behavioural tests of prompts/tools against the live model,
  [src/eval/](src/eval/) (evalite). A frameworkless agent's behaviour is its
  prompts, so prompts get tested like code.

## Commands

```bash
pnpm start          # run the TUI
pnpm dev            # file-watch reload
pnpm typecheck      # tsc --noEmit
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

Model is `gpt-4o-mini` ([src/config/model.ts](src/config/model.ts)); state
persists to `.chat-state/session.json`.
