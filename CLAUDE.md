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
  runs model → tool-call → tool-result until the model stops asking for tools,
  then streams the answer.
- **Context management** — last `KEEP_LAST_TURNS` (4) turns kept verbatim; older
  turns fold into a rolling summary ([summarizer.ts](src/conversation/summarizer.ts)).
- **Prompt caching** — out-of-window state (facts + summary) is appended LAST so
  a `/remember` or re-summarization never invalidates the cached prefix.
- **Sub-agent delegation** — `delegate_task` forks an ephemeral child agent
  ([fork.ts](src/conversation/fork.ts)) and folds a compressed handoff
  ([handoff.ts](src/conversation/handoff.ts)) back into the main thread.
- **Tools** — Zod-typed, under [src/tools/](src/tools/).
- **Prompt evals** — behavioural tests of prompts/tools against the live model,
  [src/eval/](src/eval/) (evalite). A frameworkless agent's behaviour is its
  prompts, so prompts get tested like code.

## Commands

```bash
pnpm start          # run the TUI
pnpm dev            # file-watch reload
pnpm typecheck      # tsc --noEmit
pnpm eval           # run prompt evals (needs a real OPENAI_API_KEY)
```

Model is `gpt-4o-mini` ([src/config/model.ts](src/config/model.ts)); state
persists to `.chat-state/session.json`.
