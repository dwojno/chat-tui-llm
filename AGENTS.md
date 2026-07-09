# AGENTS.md

## Project

**chat-cli is a frameworkless AI agent** — a terminal chat app whose agent loop,
context-window management, tool calling, and sub-agent delegation are all
hand-built on the **raw OpenAI SDK** (no LangChain, no agent framework). It exists
to expose the machinery frameworks hide, so favour clarity over cleverness and
keep the "frameworkless" claim true. Deep rationale lives in
[docs/architecture.md](docs/architecture.md) and [docs/database.md](docs/database.md);
keep source comment-light.

## Stack

TypeScript (ESM, run via `tsx`) · `openai` SDK (the sole LLM dependency) ·
Ink + React 19 (TUI) · Zod (tool/output schemas) · drizzle-orm + better-sqlite3
(persistence) · vitest (tests) · evalite (live-model prompt evals) ·
oxlint + oxfmt · pnpm.

## Commands

```bash
pnpm start          # run the TUI (entry: src/cli.ts → loads .env → src/main.ts run())
pnpm dev            # file-watch reload
pnpm typecheck      # tsc --noEmit (full strict set; must stay green)
pnpm lint           # oxlint  (pnpm lint:fix to autofix)
pnpm format         # oxfmt .  (format:check for CI, no writes)
pnpm test           # unit + e2e (vitest, model mocked — no API key needed)
pnpm eval           # prompt evals (needs a real OPENAI_API_KEY)
pnpm db:generate    # regenerate drizzle migrations after editing store/sqlite/schema.ts
pnpm db:studio      # open drizzle-kit studio against the SQLite db
```

```bash
pnpm test tests/agent/service.test.ts   # a single file
pnpm test -t "delegation"               # filter by test-name pattern
pnpm test:watch                         # watch mode
```

## Architecture

Three independent layers plus a thin composition root ([src/main.ts](src/main.ts));
dependencies point **one way**: `ui`/`integration` → `agent`, never back.

```
src/
  agent/         # pure core — no fs, no Ink, no persistence. Reusable (e.g. web/SSE)
    agent.ts       # AgentService.run() — the stateless model→tool→result loop
    events/        # TurnEvent stream + merge.ts (fan-in of concurrent generators)
    tools/         # Zod-typed tools; delegate_task is just a registry tool
    tokens/        # summarizer.ts — rolling-summary context management
    prompts/       # system + fork instructions (tested by evals/)
  ui/            # Ink TUI — a thin for-await…switch adapter over the event stream
  integration/   # wiring: repl.ts, session.ts, OpenAI client, commands/, file-mentions
  store/         # Store facade → sqlite/ namespace clients (conversation/fact/sources)
docs/            # architecture.md, database.md — the "why"
tests/           # mirrors src/; e2e/ drives the real REPL. Model mocked (offline)
evals/           # behavioural prompt tests against the live model (evalite)
```

**Data flow:** input → `processLine` ([repl.ts](src/integration/repl.ts)) →
`Session.runTurn` ([session.ts](src/integration/session.ts)) → `AgentService.run`
yields `TurnEvent`s → repl `for await…switch` → Ink chat. The Session owns all
state (transcript, rolling summary, pinned facts, usage) and persists via the
`Store`; the agent **retains nothing** after a turn. Last `KEEP_LAST_TURNS` (4)
turns stay verbatim, older ones fold into a summary appended LAST to preserve the
cached prompt prefix. The model→tool loop is capped at `MAX_TOOL_STEPS` (8);
config in [src/agent/config/index.ts](src/agent/config/index.ts) (`gpt-4o-mini`).

## Testing

`tests/` mirrors `src/` (`agent/`, `integration/`, `ui/`), plus `e2e/` (drives the
real REPL flow) and `helpers/` + `fixtures/`. Conventions:

- **No live LLM/API calls, ever.** The model is always mocked via
  [tests/helpers/mock-openai.ts](tests/helpers/mock-openai.ts) — the suite is
  offline, deterministic, and fast (full run ~1.2s; a subdir subset <1s), so no
  test is flaky and none needs quarantining. Live-model checks belong in `evals/`
  (`pnpm eval`), never here.
- **Name tests by observable behaviour** ("blocks cwd traversal"), not by method
  name, and follow Arrange–Act–Assert. Keep sample data in `tests/fixtures/`.

## Code style

Optimise for a reader who has never seen the file. Favour **small pure functions
with descriptive names**, guard clauses over nested branches, and immutable data
(copy with spread — `{ ...totals }`, `[...items]`; take `readonly` params). Prefer
`map`/`filter`/`flatMap` over manual index loops and mutation. Keep stateful
adapters in classes with dependencies injected as `private readonly` constructor
params, and keep the logic they call in pure, exported functions
([src/store/derive.ts](src/store/derive.ts) is the model). Easy to read _is_ easy
to maintain — if a block needs a comment to be understood, extract and name it
instead.

**Push computation into the database; Node.js does as little as possible.** Filter,
order, limit, and aggregate in SQL via the drizzle query builder — never pull rows
back to loop over them in JS. Batch writes go through `db.transaction`.

```ts
// ✅ filtering, the summary boundary, and ordering all happen in SQL
const rows = this.db
  .select()
  .from(conversationItem)
  .where(and(...conditions))
  .orderBy(conversationItem.id)
  .all();
// ✅ aggregate in SQL
const row = this.db
  .select({ total: sum(conversationItem.outputTokens) })
  .from(conversationItem)
  .where(eq(conversationItem.sessionId, id))
  .get();
// ❌ fetch every row just to add them up in Node
rows.reduce((n, r) => n + r.outputTokens, 0);
```

Reserve Node for what SQL can't express — token estimation, JSON payload parsing,
turn-boundary windowing.

**Invariants use `node:assert`, not `?? ""` or `!`** — silently coercing a
would-be-`undefined` hides bugs; assert surfaces them.

```ts
// ✅ a missing output here is a real bug — fail loudly
const output = outputs[index];
assert(output !== undefined);
// ❌ masks the bug; sends "" to the model
const output = outputs[index] ?? "";
```

**Satisfy `exactOptionalPropertyTypes` by omitting props, not passing `undefined`.**

```ts
// ✅
yield { type: "tool", name, ...(detail !== undefined ? { detail } : {}) };
// ❌ TS2375 — optional prop set to undefined
yield { type: "tool", name, detail };  // detail: string | undefined
```

**Tools are async generators** that `yield` `TurnEvent`s and `return` the output
string; args are typed from the Zod schema via `z.infer`.

```ts
async function* execute({ city }: z.infer<typeof parameters>): AsyncGenerator<TurnEvent, string> {
  yield { type: "status", text: `Looking up ${city}` };
  return `The weather in ${city} is sunny`;
}
```

**Never import outward from `agent/`.**

```ts
// ❌ inside src/agent/** — breaks the one-way dependency rule
import { renderChat } from "../ui/chat";
```

`any` and non-null `!` are lint errors in `src/`; prefer `assert` over `!` in
`tests/` too, even though the lint override permits `!` there. Keep rationale in
`docs/`, not inline comments.

## Boundaries

**Always OK** — add a tool under [src/agent/tools/](src/agent/tools/) (register it in
`mainTools`/`forkTools`); edit prompts in [src/agent/prompts/](src/agent/prompts/)
alongside an eval; add/extend tests; run `typecheck`/`lint`/`format`/`test` freely.

**Ask first** — adding any npm dependency (especially an LLM/agent library — it
threatens the frameworkless claim); changing the model, `KEEP_LAST_TURNS`, or
`MAX_TOOL_STEPS`; editing [store/sqlite/schema.ts](src/store/sqlite/schema.ts) or the
`Store` interface (then run `db:generate`); reshaping the `TurnEvent` contract.

**Never** — import `ui/` or `integration/` from `agent/`; introduce an agent
framework or SDK abstraction over `openai`; give `delegate_task` to forks (infinite
recursion); re-introduce heavy inline rationale comments.
