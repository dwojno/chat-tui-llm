# chat-cli

A terminal AI chat app built to explore LLM engineering fundamentals — context-window management, prompt caching, tool calling, and structured output. Uses the OpenAI Responses API with an [Ink](https://github.com/vadimdemedes/ink) (React) TUI.

## Setup

```bash
pnpm install
echo "OPENAI_API_KEY=sk-..." > .env
pnpm start
```

Options:

- `pnpm dev` — start with file-watch reload
- `pnpm typecheck` — type-check without emitting

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

On exit, a token-savings report compares actual input tokens against a naive "re-send everything" baseline.

## How it works

- **Context window** — only the last `KEEP_LAST_TURNS` (4) turns are kept verbatim; older turns are folded into a rolling summary and dropped, keeping a stable, cacheable prompt prefix.
- **State** — the summary, pinned facts, and usage totals persist to `.chat-state/session.json` between runs.
- **Tools** — the model can call registered tools (e.g. `get_weather_data`); add more under [src/tools/](src/tools/).

## Structure

```
src/
  app.ts            composition root
  cli/              arg parsing + REPL loop
  commands/         slash/keyword commands
  conversation/     turn service, summarizer, state, schemas
  config/           model + session settings
  tools/            function-calling tools
  ui/               Ink chat + markdown rendering
```
