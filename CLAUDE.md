# CLAUDE.md

## What this is

chat-cli — a **frameworkless** terminal AI agent: the agent loop, context-window management, tool
calling, and sub-agent delegation are hand-built on the raw `openai` SDK (no LangChain, no agent
framework). It exists to expose the machinery frameworks hide, so favour clarity over cleverness and
keep the frameworkless claim true. Source is comment-light; the "why" lives in `docs/`
(`architecture`, `agent-loop`, `database`, `rag`, `evals`, `observability`, `security`).

Stack: TypeScript ESM run via `tsx` · Ink + React 19 (TUI) · Zod (tool/output schemas) ·
drizzle-orm + better-sqlite3 · vitest (tests) · evalite (live-model evals) · oxlint/oxfmt · pnpm ·
`just` (task runner — `brew install just`).

## Agent skills

### Issue tracker

Issues are tracked as local Markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the canonical `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` roles. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.

## Commands

Root `just` is workspace-only (gates + suite groups + infra). Each app/package has its own
justfile — run via `just <name> <recipe>` (e.g. `just cli start`, `just agent test`).

- `just check` — typecheck + lint + format-check + knip + unit test — the pre-commit gate
- `just test` — unit tests in every app + package (delegates to each justfile)
- `just typecheck` · `just lint` (`lint-fix`) · `just format` (`format-check`) · `just knip`
- Suite groups (every member that has them): `just integration` · `just e2e` / `just e2e-full` · `just eval`
- `just infra` — Qdrant + Langfuse stack · `just qdrant` — Qdrant only
- CLI: `just cli start` · `just cli db-generate` / `db-studio` · `just cli eval-watch` / `eval-rag`
- Packages: `just agent|engine|platform|tools|store test` (and `test-watch` where applicable)

## Architecture (map only — depth in `docs/`)

Monorepo: reusable libraries under `packages/` (`@chat/agent`, `@chat/engine`, `@chat/tools`,
`@chat/platform`, `@chat/store` contract), deployable host under `apps/cli`. The CLI app owns its
composition root (`main.ts`/`cli.ts`), session/commands/input/ui, unified `config.ts`, and the
SQLite `LocalStore` implementation under `apps/cli/src/backend/`. Imports use `@/*` (→
`apps/cli/src/*`) **inside the CLI app only** (`apps/cli/tsconfig.json`) and `@chat/*` across packages.
The data flow and agent loop are in `docs/agent-loop.md`.

- **Dependencies point one way — inward on `@chat/agent`.** The core imports nothing from `ui/`,
  the store impl, or the CLI app. Config/prompt/loop constants (model, temperature, `MAX_TOOL_STEPS`)
  are **injected**, never imported inside `packages/agent/`.
- **The EventBus is UI-only and never persisted** — it carries `delta`/`tool`/`status`/`approval_*`
  for the UI; anything durable (the event log, token usage) rides in the return value.

## Conventions (the non-obvious, load-bearing ones)

- Invariants use `node:assert`, not `?? ""` or `!` — surface the bug, don't mask it.
- A function with more than two args takes one named-args object, destructured at the signature.
- `exactOptionalPropertyTypes`: satisfy by **omitting** the prop, not passing `undefined`.
- Tools are plain async functions returning the output string; args typed via `z.infer`; progress
  via `ctx?.bus.emit(...)`. Register in `createAgentTools` (`tools` or a `forkProfiles` entry).
- **Push computation into SQL** (filter/order/limit/aggregate via drizzle — don't pull rows to loop
  in Node); batch writes go through `db.transaction`. Domain rules live on the CLI `backend/`
  facades that implement the `@chat/store` contract; `OneOrMany<T>` + `asArray()` at batch
  boundaries. Model file: `apps/cli/src/backend/conversation/helpers.ts`.
- `any` and non-null `!` are lint errors in package/app source. No inline rationale comments — put it in `docs/`.
  Before adding an abstraction, ask: would a senior engineer call this overcomplicated? Prefer the
  boring, direct solution; add structure only when a concrete need forces it.

## Workflow

- New feature / fix: branch off `main` (`git switch -c <type>/<slug>`); never
  commit directly to `main`.
- After finishing and passing `just check`, offer to open a PR with `gh pr create` — **always ask first**, never open one unprompted.
- CI (`.github/workflows/ci.yml`) runs static checks + unit + integration + e2e
- eval on every PR and push to `main`; keep it green.

## Gotchas / boundaries

- **Migrations:** after editing `apps/cli/src/backend/db/schema.ts`, always regenerate with `just cli db-generate`
  (the only way to add a migration). Never hand-write a migration SQL file or edit
  `migrations/meta/_journal.json`.
- **Ask first:** adding any npm dep (especially an LLM/agent lib — threatens the frameworkless
  claim); changing the model, `KEEP_LAST_TURNS`, or `MAX_TOOL_STEPS`; editing `schema.ts` or the
  `Store` interface; reshaping the `TurnEvent` contract or the `Agent` step/executeTool signatures.
- **Never:** import outward from `@chat/agent`; route storable data through the EventBus; add an
  agent framework (LangChain et al.) that hides the loop. A thin provider `Model` adapter
  (`Model.fromOpenAI` / `fromAnthropic`) for generations is fine — raw SDK clients stay at the
  composition root. Never give `delegate_task[s]` to forks (infinite recursion).
