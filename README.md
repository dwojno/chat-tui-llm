# chat-cli

A **frameworkless AI agent** in your terminal — the agent loop, context management, tool calling, and sub-agent delegation are all hand-built on the raw OpenAI SDK. No agent framework, nothing hiding the mechanics. Streaming replies land in an [Ink](https://github.com/vadimdemedes/ink) (React) TUI.

The point isn't the chat — it's the machinery underneath. Every layer an agent framework hides behind its magic is here in plain sight and under direct control: the request loop, the token budget, the tool wiring, the sub-agent handoffs. If you've ever wanted to see what actually happens when an "agent" thinks, this is the whole thing, unabstracted.

## What it does

- **Agent loop** — runs the model → tool-call → tool-result cycle by hand until the model stops asking for tools, then streams the answer. [`service.ts`](src/conversation/service.ts)
- **Context-window management** — only the last 4 turns are kept verbatim; older turns fold into a rolling summary and are dropped, keeping a stable, cacheable prompt prefix. [`summarizer.ts`](src/conversation/summarizer.ts)
- **Prompt caching** — out-of-window state (facts + summary) is pinned to the *end* of the input so a `/remember` or a re-summarization never invalidates the cached prefix above it.
- **Sub-agent delegation** — the model can spin up an ephemeral child agent for multi-step work, which runs in its own context and hands back a compressed digest. [`fork.ts`](src/conversation/fork.ts), [`handoff.ts`](src/conversation/handoff.ts)
- **Tool calling** — typed, Zod-validated tools the model can invoke; add your own under [src/tools/](src/tools/).
- **Structured output** — replies validated against a Zod schema, plus a raw JSON mode.
- **Prompt evals** — behavioural tests that grade the prompts and tools against the live model. See [src/eval/](src/eval/).

## Setup

```bash
pnpm install
echo "OPENAI_API_KEY=sk-..." > .env
pnpm start
```

- `pnpm dev` — start with file-watch reload
- `pnpm typecheck` — type-check without emitting
- `pnpm eval` — run the prompt evals ([details](src/eval/))

## Usage

```bash
pnpm start -- --temperature 0.7   # -t for short; default 0.5
```

At the `>` prompt, type a message for a streaming reply, or use a command:

| Command | Description |
| --- | --- |
| `/remember <fact>` | Pin a fact; injected into every later turn (survives truncation) |
| `/json <prompt>` | Reply in JSON output mode |
| `/structured <prompt>` | Reply validated against a Zod schema (answer + sources) |
| `exit` | Leave the REPL (Ctrl+C / Ctrl+D also work) |

On exit, a token-savings report compares actual input tokens against a naive "re-send everything" baseline — the payoff of the context management above.

## How the agent loop works

Each turn, the service sends the trimmed conversation plus a context block (pinned facts + rolling summary) to the model. If the response contains tool calls, it executes them, appends the results, and asks again — looping until the model answers with no further calls. A `delegate_task` call is special-cased: instead of running inline, it forks a fresh child agent with its own tools and window, then folds a short handoff back into the main thread.

After each answer, the window is trimmed deterministically: keep the last 4 turns, summarize and evict the rest. State (summary, pinned facts, usage totals) persists to `.chat-state/session.json` between runs.

## Structure

```
src/
  app.ts            composition root — build every dependency once
  cli/              arg parsing + REPL loop
  commands/         slash/keyword commands
  conversation/     agent loop, summarizer, fork/handoff, state, schemas
  config/           model + session settings, system prompts
  tools/            function-calling tools
  ui/               Ink chat + markdown rendering
  eval/             prompt evals (see src/eval/README.md)
```
