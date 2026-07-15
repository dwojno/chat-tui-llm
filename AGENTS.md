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
pnpm db:generate    # regenerate drizzle migrations after editing src/store/db/schema.ts
pnpm db:studio      # open drizzle-kit studio against the SQLite db
```

```bash
pnpm test tests/app/runner/runner.test.ts   # a single file
pnpm test -t "delegation"               # filter by test-name pattern
pnpm test:watch                         # watch mode
```

## Architecture

Focused layers plus a thin composition root ([src/main.ts](src/main.ts));
dependencies point **one way** — everything depends inward on `agent/` (and on the
leaf infra in `platform/`), never the reverse.

Imports use the `@/*` alias (→ `src/*`), so the import path mirrors this tree —
`@/agent/agent`, `@/app/tools/weather`, `@/store/conversation`. Three core PILLARS
(`agent`, `store`, `ui`), one MIDDLE integrator/configurator (`app/`), and leaf
INFRA (`platform/`).

```
src/
  agent/         # PILLAR — pure core; no loop, no fs, no Ink, no persistence. All deps injected.
    agent.ts       # Agent: step() (ONE model call, streams delta to the bus) + executeTool()
    events/        # TurnEvent (UI-only union) + bus.ts (EventBus: subscribe/emit/scoped)
    humanLayer/    # approval + clarification gate CONTRACT types (policy lives in app/runner/)
    conversation/  # TurnOptions, TurnContext/TurnProfile/ToolRunContext, item helpers
    tools/         # tool CONTRACT only: ToolDefinition + registry helpers (impls in app/tools/)
  store/         # PILLAR — Store facade → domain facades (profile/conversation/memory/sources)
    db/            # SQLite connection, schema, migrations (only store imports it)
  ui/            # PILLAR — Ink TUI — driven by an EventBus subscription
  app/           # MIDDLE — integrator + configurator (wires the pillars into a working agent)
    runner/        # runAgentLoop (runner.ts) + thread/ — reducer, AgentEvent log, windowing, SDK⇄event convert
    session/       # thin wiring: session.ts (state + persistence), switch.ts, usage.ts
    tools/         # tool IMPLEMENTATIONS: weather, web-search, disk, rag, ask-user, control-intents,
                   #   scratchpad, delegation/ (delegate_task[s] + handoff + fork-result), prompts/, format.ts
    commands/      # user-intent handlers (/learn, /conversation, /structured, …)
    input/         # repl.ts (REPL input loop, subscribes to the bus) + file-mentions.ts
    context/       # <user_known_memories> block assembly
    tokens/        # rolling-summary summarizer + token estimation
    config.ts      # app constants: model / temperature / cache-key / MAX_TOOL_STEPS / MAX_CONSECUTIVE_ERRORS
    prompts.ts     # orchestrator system prompt (fork prompts live in app/tools/prompts/)
  platform/      # INFRA — leaf, used everywhere
    telemetry/     # OTel spans + pricing + OTLP setup
    utils/         # shared helpers
    cli/           # args, config, env, shutdown (CLI boot/teardown)
  main.ts cli.ts # composition root + entry
docs/            # architecture, agent-loop, database, rag, evals, observability — the "why"
tests/           # mirrors src/; e2e/ drives the real REPL. Model mocked (offline)
evals/           # behavioural prompt tests against the live model (evalite)
```

RAG spans two layers by design: the engine/persistence lives in `store/sources/rag/`
(it IS a data source), the agent-facing tools in `app/tools/` (`rag.ts`, `read-source.ts`,
`list-sources.ts`, `search-knowledge-base.ts`). Known layering smell (deferred):
`store/` and `app/tokens/` still import `AgentEvent`/`usage` from `app/runner`/`app/session`
— a pillar→middle inversion; the fix is to extract those into a neutral shared contract.

**Data flow:** input → `processLine` ([app/input/repl.ts](src/app/input/repl.ts), which
subscribes to the injected `EventBus`) → `Session.runTurn`
([app/session/session.ts](src/app/session/session.ts)) → `runAgentLoop`
([app/runner/runner.ts](src/app/runner/runner.ts)). The runner owns the loop: it folds the
owned `AgentEvent[]` log into one packed `<user>` message via the reducer
([app/runner/thread/](src/app/runner/thread/)), calls the pure primitives `Agent.step()`
(one model call) and `Agent.executeTool()` (dispatch one tool, fanned out with
`Promise.all`) — interpreting the reserved control intents `done_for_now` /
`request_more_information` (and folding `update_scratchpad` into working-memory state)
by name — runs the approval gate at the
tool-selection→invocation seam, caps at `MAX_TOOL_STEPS` (8) and
`MAX_CONSECUTIVE_ERRORS` (3), and **returns** `{ answer, events, usage }`. The
**`EventBus` is UI-only and never persisted** — it carries
`delta`/`tool`/`status`/`approval_*` for observability; anything durable (the
transcript event log, token `usage`) rides in the return value. `step()` streams
`delta` to the bus _while_ the model streams, so time-to-first-token is immediate.
`Session` owns all state, persists the returned events/usage via the `Store`, and the
agent **retains nothing**. Last `KEEP_LAST_TURNS` (4) turns stay verbatim; older ones
fold into a rolling summary — the reducer orders the packed prompt summary → events →
memories → scratchpad, so a `/remember` changes only the tail and never invalidates the
cached prefix above it. The `<scratchpad>` block is a second fold (`deriveScratchpad`)
over the same log — the agent's private, temporary working memory (todo/plan/findings),
rendered from `update_scratchpad` ops but suppressed from the transcript itself. The agent is context-free: the reducer folds the event log, summary,
and the `<user_known_memories>` block (numbered via `keyMemories`,
[app/context/context.ts](src/app/context/context.ts)) into that one message — `step()` just
takes the input.

**Models are role-routed** (config constants): the orchestrator turn runs
`ORCHESTRATOR_MODEL` (`gpt-5.6-luna`, a reasoning model, overridable per user-profile
via the `model` column); forks run `FORK_MODEL`; the handoff compressor runs
`HANDOFF_MODEL` and the rolling summarizer `SUMMARIZER_MODEL`. Precedence is
`turnProfile.model ?? options.model` in `buildRequestParams` — the orchestrator leaves
`turnProfile.model` unset so the user-profile/`ORCHESTRATOR_MODEL` (via `options.model`)
wins, while a fork sets `turnProfile.model = FORK_MODEL`. **Temperature is code-defined
only** (`TEMPERATURE` constant) and sent on non-reasoning turns; `buildRequestParams`
omits it for reasoning models (the `gpt-5` family and `o`-series), which reject the
param. `reasoningEffort` is plumbed on `TurnProfile` — active on reasoning models,
inert on the rest.

**Memories** (persistent per-profile notes, formerly "facts") ride in
`TurnContext.memories`, render as numbered `M1…Mn` in `<user_known_memories>`, and
`/remember` pins them. When delegating, the orchestrator passes only the
`relevantMemoryKeys` a sub-task needs — the fork sees that subset, not the whole set.

**Delegation** ([src/app/tools/delegation/](src/app/tools/delegation/)) is one generic
mechanism (`delegate_task` for a single sub-task, `delegate_tasks` for up to
`MAX_PARALLEL_TASKS` (6) independent forks fanned out via `Promise.all`). Both share
`runFork`, which calls `ctx.runTurn` (the runner's `runAgentLoop`) for a fresh
sub-turn under a `bus.scoped(title)` — so the fork's `tool`/`status` events surface
tagged, and its transcript comes back as the returned `items`. A fork runs under a
named **fork profile** (`forkProfiles` in `createAgentTools`, threaded through
`AgentDeps` → `Agent` → `ToolRunContext`), selected by the `profile` arg: `general`
(web_search + weather) or `rag_research` (knowledge-base tools). Each profile carries
executable `ToolDefinition`s; `Agent` flattens them into its dispatch registry and
derives per-fork schemas. A fork's transcript is compressed by `compressHandoff` into
a structured `ForkResult` (`responses.parse`) — exact values (numbers/paths/IDs) go
verbatim into `findings`, not prose — and returned to the parent as JSON, so only a
digest re-enters context.

## Design: SRP and domain boundaries

Layer responsibilities stay narrow — **domain rules live in `store/`, user intent in
`app/commands/`, lifecycle in `app/session/`**:

| Layer                      | Owns                                                          | Example                                                                                                      |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `store/<domain>/`          | Persistence + domain invariants                               | `ConversationFacade.pruneEmpty()` — a conversation with no assistant reply has no value and may be discarded |
| `app/commands/`            | Parse user input, call facades, update UI                     | `/conversation` switches context; it does **not** prune or title                                             |
| `app/session/session.ts`   | Turn orchestration (model input, windowing, profile settings) | `runTurn` resolves the orchestrator model once per turn                                                      |
| `platform/cli/shutdown.ts` | Exit housekeeping                                             | `buildExitMessage` prunes empty conversations, then prints report + resume hint                              |

**One place per concern.** The orchestrator `model` resolves in `Session.runTurn`;
empty-conversation cleanup runs in `buildExitMessage` on exit — never in command
handlers. Commands return `{ kind: "handled" }` or `{ kind: "turn", … }`; they do
not reach into unrelated domains.

When adding behaviour, ask: _which aggregate owns this rule?_ Put it on that facade
(or a pure helper next to it), then call it from the thinnest adapter that needs it.

**Facades compose; repositories query.** A facade method should first try to express
behaviour from existing repository primitives — fluent `query()` filters, `delete`,
`create`, etc. Add a repository method only when SQL needs a new shape (a filter, a
join, a bulk statement). Push filters into the query builder (`EXISTS`, `json_extract`,
aggregates) instead of fetching rows to filter in Node.

```ts
// ✅ domain rule on the facade — composes query + batch delete
async pruneEmpty(profileId?: string): Promise<void> {
  let query = this.query().withoutAssistantReply();
  if (profileId !== undefined) query = query.forProfile(profileId);
  const toRemove = await query.execute();
  await this.delete(toRemove.map((conv) => conv.id));
}

// ❌ one-off repository method that duplicates what a query filter could express
async pruneEmpty(): Promise<void> {
  for (const conv of await this.query().execute()) {
    if (!(await this.hasAssistantMessage(conv.id))) this.deleteConversation(conv.id);
  }
}
```

**Batch create/delete accept `T | T[]`.** Use `OneOrMany<T>` and `asArray()` from
[`src/store/helpers.ts`](src/store/helpers.ts) at repository and facade boundaries.
Facades expose one method; repositories normalise to arrays and use `inArray` (or a
transaction loop for multi-table deletes).

```ts
// facade
async delete(id: OneOrMany<string>): Promise<void> {
  this.repo.deleteConversations(asArray(id));
}

async createItems(conversationId: string, items: OneOrMany<ConversationItemInsert>): Promise<void> {
  this.repo.insertItems(conversationId, items);
}
```

Do not split into `createItem` / `createItems` or loop single-row deletes in the
facade when SQL can batch.

**Wrap multi-step writes in `repository.transaction()`.** Any facade or repository
method that performs more than one mutating SQL statement on related rows must run
inside a single transaction — nested calls reuse the same transactional handle.

```ts
// ✅ append user message + rename in one commit
appendUserMessage(conversationId, item, title) {
  this.repo.transaction((repo) => {
    repo.insertItems(conversationId, item);
    if (title !== undefined) repo.updateConversation(conversationId, title);
  });
}

// ❌ two independent commits — a crash between them leaves inconsistent state
await createItems(conversationId, item);
await update(conversationId, { title });
```

Expose `repository.transaction()` to the facade when a multi-step write must commit
or roll back atomically. Do not expose raw SQL or the Drizzle handle outside
`store/<domain>/`.

## Testing

`tests/` mirrors `src/` — the pillars (`agent/`, `store/`, `ui/`), the middle
(`app/`: `runner/`, `session/`, `tools/`, …), and infra (`platform/`) — plus `e2e/`
(drives the real REPL flow) and `helpers/` + `fixtures/`. Test files import
production code via `@/…` and shared helpers via `@tests/…`, so a test sits next to
the module it exercises. Conventions:

- **No live LLM/API calls, ever.** The model is always mocked via
  [tests/helpers/mock-openai.ts](tests/helpers/mock-openai.ts) — the suite is
  offline, deterministic, and fast (full run ~1.2s; a subdir subset <1s), so no
  test is flaky and none needs quarantining. Live-model checks belong in `evals/`
  (`pnpm eval`), never here.
- **Name tests by observable behaviour** ("blocks cwd traversal"), not by method
  name, and follow Arrange–Act–Assert. Keep sample data in `tests/fixtures/`.

## Code style

**The overriding test: would a senior engineer say this is overcomplicated?** Before
adding an abstraction, layer, parameter, or indirection, ask whether it earns its
keep — if a seasoned reader would raise an eyebrow, cut it. Prefer the boring, direct
solution; add structure only when a concrete need forces it, never speculatively.

Optimise for a reader who has never seen the file. Favour **small pure functions
with descriptive names**, guard clauses over nested branches. Prefer
`map`/`filter`/`flatMap` over manual index loops and mutation. Keep stateful
adapters in classes with dependencies injected as `private readonly` constructor
params, and keep the logic they call in pure, exported functions
([src/store/conversation/helpers.ts](src/store/conversation/helpers.ts) is the model).

**Naming carries the meaning, not comments.** Name variables, function arguments,
and helpers so the code reads without annotation. Needing a comment is a signal the
code is too hard to reason about — extract and name it, or simplify, instead of
explaining it. Escalate only when naming can't carry it: crucial context goes to
`docs/`; something genuinely long/crucial/irreducibly complex goes **here in Code
style**, never as an inline comment. `.describe()` schema strings and prompt text
are model-facing content, not comments.

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
  .where(eq(conversationItem.conversationId, id))
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

**Tools are plain async functions** returning the output string; args are typed from
the Zod schema via `z.infer`. To report progress, emit a `TurnEvent` on the injected
UI bus via `ctx.bus.emit(...)` (optional — most tools just `return`).

```ts
async function execute(
  { city }: z.infer<typeof parameters>,
  ctx?: ToolRunContext,
): Promise<string> {
  ctx?.bus.emit({ type: "status", text: `Looking up ${city}` });
  return `The weather in ${city} is sunny`;
}
```

**A function with more than two arguments takes a single named-arguments object**
(destructured at the signature), never a positional list — e.g. `Agent.step`,
`runAgentLoop`, `RunTurn`. Two args or fewer may stay positional.

```ts
// ✅
async step(args: StepArgs): Promise<StepResult> { … }
// ❌ 5 positional params
async step(messages, options, profile, bus, forbidTools) { … }
```

**The agent is a pure function of injected deps.** `Agent`'s constructor takes every
collaborator and constant it needs (`openai`, `model`/`temperature`/`cacheKey`,
`instructions`, `tools`, `forkProfiles`) — never import config/prompt constants
inside `src/agent/`. `MAX_TOOL_STEPS` is a loop concern injected into `runAgentLoop`.

**Never import outward from `agent/`.**

```ts
// ❌ inside src/agent/** — breaks the one-way dependency rule
import { renderChat } from "../ui/chat";
```

`any` and non-null `!` are lint errors in `src/`; prefer `assert` over `!` in
`tests/` too, even though the lint override permits `!` there. Keep rationale in
`docs/`, not inline comments.

## Boundaries

**Always OK** — add a tool implementation under [src/app/tools/](src/app/tools/) (register it
in `createAgentTools`'s `tools` or a `forkProfiles` entry); edit the system prompt in
[src/app/prompts.ts](src/app/prompts.ts) or fork prompts in
[src/app/tools/prompts/](src/app/tools/prompts/) alongside an eval; add/extend tests; run
`typecheck`/`lint`/`format`/`test` freely.

**Ask first** — adding any npm dependency (especially an LLM/agent library — it
threatens the frameworkless claim); changing the model, `KEEP_LAST_TURNS`, or
`MAX_TOOL_STEPS`; editing [src/store/db/schema.ts](src/store/db/schema.ts) or the
`Store` interface (then run `db:generate`); reshaping the `TurnEvent` contract or the
`Agent` step/executeTool signatures.

**Never** — import `ui/`, `store/`, or anything under `app/` (`session/`, `runner/`,
`commands/`, `tools/`, …) from `agent/` (the core imports nothing outward); route storable data through the
`EventBus` (it is UI-only, never persisted); introduce an agent framework or SDK
abstraction over `openai`; give `delegate_task`/`delegate_tasks` to forks (infinite
recursion); re-introduce heavy inline rationale comments.
