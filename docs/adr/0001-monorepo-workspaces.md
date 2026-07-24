---
status: accepted
---

# Restructure into a pnpm-workspaces monorepo (apps + reusable packages)

## Context

chat-cli began as a single package with a flat `src/` (layers `agent` → `store`/`ui`/`app` →
`platform`, `@/*` alias, run directly via `tsx`, no build step). The CLI is the first
implementation; a multi-tenant **web** app is the next. To let both share the agent core, the
loop, the tools, and the infra without copy-paste, we restructure into a **pnpm-workspaces
monorepo**: deployable entry points live in `apps/`, reusable libraries in `packages/`, all under
the `@chat/*` scope.

## Package map

```
apps/
  cli/              Ink TUI, session, commands, REPL input, unified config,
                    the SQLite Store implementation under src/backend/ (schema, drizzle,
                    repos, migrations, active-state), and the composition root.
packages/
  @chat/agent       Pure core: agent.ts, events/bus, tools/types, humanLayer, conversation
                    contracts. Also owns the persisted turn-event type (AgentEvent).
  @chat/engine      Reusable orchestration: runAgentLoop + thread reducer/convert, token
                    windowing, control-intents, scratchpad, response format.
  @chat/tools       Tool implementations (disk, web-search, rag, delegation), depending on
                    @chat/agent + the store contract.
  @chat/platform    Leaf infra: telemetry, utils, resilience, the openai Model adapter.
  @chat/store       Store CONTRACT only — the Store + per-domain facade interfaces and plain
                    domain value types. No SQLite, no drizzle, no better-sqlite3.
```

Dependencies point inward, exactly as before. pnpm's strict `node_modules` enforces the arrows
mechanically: a package can only import what it declares, so `@chat/agent` cannot resolve
`@chat/ui`.

## Decisions and the trade-offs behind them

- **Source-only internal packages, no build step.** Package `exports` point straight at `.ts`
  entries; everything keeps running through `tsx`; the future web app (Vite/Next) transpiles
  workspace TS natively. _Rejected:_ compiling each package to `dist/` — more correct for
  publishing but adds build orchestration and slows the dev loop, against the frameworkless/lazy
  ethos. The build is deferred until publishing or isolated type-checking actually forces it.

- **Contract-only `@chat/store`; the SQLite implementation moves into `apps/cli`.** The facades
  are thin wrappers over drizzle-bound query builders — little backend-agnostic logic — and
  multi-tenant web will rewrite the queries anyway (tenant scoping, likely Postgres). So the
  shared artifact is the **interface + value types**, not the facade logic. The web app later
  writes its own multi-tenant implementation of the same interface. _Rejected:_ sharing the
  facades and making the Repository the swappable port — would force abstracting the drizzle query
  builders now, for a second backend that doesn't exist yet (YAGNI).

- **`AgentEvent` lives in `@chat/agent`.** It is the persisted turn-event contract, consumed by
  both the engine (reducer) and the store (persistence). Placing it in the pure core keeps both
  `@chat/store` and `@chat/engine` depending _inward_; the store never depends on the engine.

- **Minimal-config, root-orchestrated checks.** Essentially one TypeScript config (a root base
  with the current strict options); oxlint/oxfmt glob the whole tree from root; one vitest
  workspace config globs `packages/*` and `apps/*`. A single root `tsc --noEmit` still catches an
  illegal cross-package import, because the node_modules symlink won't exist unless the dep is
  declared. `just check` stays typecheck + lint + format-check + test, now spanning the workspace.

- **Tests co-locate with their owner.** Package unit tests live with their package; the CLI's
  prompt evals, PTY e2e, and integration suites live under `apps/cli`.

- **`apps/cli` keeps its internal `@/*` alias**, scoped to its own `src`, to avoid rewriting
  hundreds of intra-app imports. `@chat/*` specifiers are used only across package boundaries.

## Migration sequence (contain the chaos)

Scaffold first, then extract one package per PR in dependency (leaf-first) order, keeping
`just check` green at every step so nothing that stays behind imports a not-yet-extracted package:

0. **Scaffold only** — `pnpm-workspace.yaml` + root `package.json`/`justfile`; move all current
   `src`/`tests` verbatim into `apps/cli/`; `@/*` still resolves inside cli. Zero logic changes.
1. **`@chat/agent`** — pure core; relocate `AgentEvent` here.
2. **`@chat/platform`** — leaf infra.
3. **`@chat/store`** — extract the contract; push the SQLite impl into `apps/cli`; untangle the
   outward imports.
4. **`@chat/tools`** — depends on agent + store contract + platform.
5. **`@chat/engine`** — the loop/reducer/tokens/control-intents/scratchpad.

## Consequences

- The frameworkless claim is _strengthened_: the loop lives in a plain `@chat/engine` package with
  no framework, reusable by any host.
- Migrations (`just db-generate`) move under `apps/cli` with the schema.
- Adding a workspace package is a new "ask first" boundary alongside the existing ones.
