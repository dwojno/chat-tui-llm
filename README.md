# chat-cli

A **frameworkless AI agent** in your terminal — the agent loop, context management, tool calling, and sub-agent delegation are all hand-built on the raw OpenAI SDK. No agent framework, nothing hiding the mechanics. Streaming replies land in an [Ink](https://github.com/vadimdemedes/ink) (React) TUI.

The point isn't the chat — it's the machinery underneath. Every layer an agent framework hides behind its magic is here in plain sight and under direct control: the request loop, the token budget, the tool wiring, the sub-agent handoffs. If you've ever wanted to see what actually happens when an "agent" thinks, this is the whole thing, unabstracted.

<p align="center">
  <img src="docs/demo.gif" alt="chat-cli in action: a streamed answer, a live tool-call trace, and a delegated sub-agent" width="800">
</p>

<sub>Demo recorded with [VHS](https://github.com/charmbracelet/vhs) — run `vhs demo.tape` to regenerate [`docs/demo.gif`](docs/demo.gif).</sub>

## What it does

- **Agent loop** — runs the model → tool-call → tool-result cycle by hand until the model stops asking for tools, then streams the answer. Independent tool calls in a single turn run in parallel. [`service.ts`](src/conversation/service.ts)
- **Context-window management** — only the last 4 turns are kept verbatim; older turns fold into a rolling summary and are dropped, keeping a stable, cacheable prompt prefix. [`summarizer.ts`](src/conversation/summarizer.ts)
- **Prompt caching** — out-of-window state (facts + summary) is pinned to the _end_ of the input so a `/remember` or a re-summarization never invalidates the cached prefix above it.
- **Sub-agent delegation** — the model can spin up ephemeral child agents for multi-step work — several in parallel — each with its own context and tools, handing back a compressed digest. The sub-agent's tool activity streams back live under a short, model-chosen label. [`fork.ts`](src/conversation/fork.ts), [`handoff.ts`](src/conversation/handoff.ts)
- **Live activity trace** — every tool call and delegation surfaces as a streaming, Gemini-style "thinking" step (with its target — the city, the search query, the sub-task) that freezes above the final answer instead of vanishing. [`chat.tsx`](src/ui/chat.tsx)
- **Tool calling** — typed, Zod-validated tools the model can invoke: a demo weather lookup and a keyless, Wikipedia-backed web search that sub-agents use for research. Add your own under [src/tools/](src/tools/).
- **Structured output** — replies validated against a Zod schema, plus a raw JSON mode.
- **Prompt evals** — behavioural tests that grade the prompts and tools against the live model. See [src/eval/](src/eval/).
- **Tests** — a Vitest suite (unit + end-to-end) that mocks the model, covering the agent loop, tool failures, delegation, and the UI — fast and fully offline. See [tests/](tests/).

## Setup

```bash
pnpm install
echo "OPENAI_API_KEY=sk-..." > .env
pnpm start
```

- `pnpm dev` — start with file-watch reload
- `pnpm typecheck` — type-check without emitting
- `pnpm test` — run the unit + e2e tests (model mocked; no API key needed)
- `pnpm eval` — run the prompt evals against the live model ([details](src/eval/))

## Usage

```bash
pnpm start -- --temperature 0.2   # -t for short; default 0.7
```

At the `>` prompt, type a message for a streaming reply, or use a command:

| Command                | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| `/remember <fact>`     | Pin a fact; injected into every later turn (survives truncation) |
| `/json <prompt>`       | Reply in JSON output mode                                        |
| `/structured <prompt>` | Reply validated against a Zod schema (answer + sources)          |
| `exit`                 | Leave the REPL (Ctrl+C / Ctrl+D also work)                       |

On exit, a token-savings report compares actual input tokens against a naive "re-send everything" baseline — the payoff of the context management above.

## How the agent loop works

Each turn, the service sends the trimmed conversation plus a context block (pinned facts + rolling summary) to the model. If the response contains tool calls, it executes them — independent calls in the same turn run concurrently — appends the results, and asks again, looping until the model answers with no further calls. A tool that throws or rejects — a bad argument, a failed request, a timeout — becomes an error result fed back to the model rather than aborting the turn, so it can recover. A `delegate_task` call is special-cased: instead of running inline, it forks a fresh child agent with its own tools and window (and the model can fan out to several forks at once), streams that sub-agent's tool activity back live, then folds a short handoff into the main thread.

After each answer, the window is trimmed deterministically: keep the last 4 turns, summarize and evict the rest. State (summary, pinned facts, usage totals) persists to `.chat-state/session.json` between runs.

## Structure

```
src/
  app.ts            composition root — build every dependency once
  cli/              arg parsing + REPL loop
  commands/         slash/keyword commands
  conversation/     agent loop, summarizer, fork/handoff, event stream, state
  config/           model + session settings, system prompts
  tools/            function-calling tools (weather, web search, delegate)
  ui/               Ink chat + activity trace + markdown rendering
  eval/             prompt evals (see src/eval/README.md)
tests/              vitest unit + e2e suites (model mocked; see tests/helpers)
```
