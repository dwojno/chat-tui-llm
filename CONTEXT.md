# chat-cli

A frameworkless terminal AI agent, restructured into a pnpm-workspaces monorepo: reusable
libraries under `packages/` (`@chat/*` scope), deployable entry points under `apps/`. This glossary
pins the load-bearing structural vocabulary so the boundaries between the layers stay sharp.

## Language

**Agent** (`@chat/agent`):
The pure core — the stateless `step()`/`executeTool()` primitives plus the tool/event/HITL
contracts. Owns no loop and no I/O; everything is injected. Also owns `AgentEvent`.
_Avoid_: engine, runner, orchestrator (those are the layer above).

**Engine** (`@chat/engine`):
The reusable orchestration layer that owns the model→tool→result loop (`runAgentLoop`), the thread
reducer/window, control-intents, and the scratchpad. Sits above the Agent, below any App.
_Avoid_: agent, framework, app, runner-as-cli.

**App** (`apps/*`):
A deployable entry point that wires the packages together for one host — `apps/cli` (Ink TUI) now,
`apps/web` (multi-tenant) next. Owns its UI, session wiring, composition root, and its concrete
Store implementation. The CLI keeps these directly under `apps/cli/src/`, with SQLite and RAG
implementation details under `apps/cli/src/backend/`.
_Avoid_: client, frontend, service.

**Package** (`packages/*`):
A reusable, host-agnostic library published under `@chat/*`, consumed as source (no build step).
_Avoid_: module, lib, workspace (as a synonym).

**Store contract** (`@chat/store`):
The `Store` and per-domain facade _interfaces_ plus plain domain value types — the seam every App
implements. It contains no persistence: SQLite/drizzle is the `apps/cli` implementation; a
multi-tenant backend will be the `apps/web` implementation.
_Avoid_: store (unqualified, when you mean the contract), database, repository.

**AgentEvent**:
One entry in the durable, serializable turn-event log — the entire resumable turn state. Lives in
`@chat/agent`; persisted by the Store, folded into a prompt by the Engine's reducer.
_Avoid_: message, bus event (the EventBus is the UI-only, non-persisted channel).
