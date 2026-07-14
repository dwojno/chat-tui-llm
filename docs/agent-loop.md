# Agent Loop

Hand-built agentic loop on the raw OpenAI Responses API — no framework. This is
the authoritative reference for how one turn runs, how the model is routed, how
memories reach the model, and how the generalized sub-agent (delegation +
structured handoff) works. For the surrounding layers see
[architecture.md](./architecture.md).

## Primitives vs. the loop

The `Agent` ([src/agent/agent.ts](../src/agent/agent.ts)) is **stateless** and owns
**no loop**. It exposes two pure primitives; every collaborator and constant is
injected via its constructor (`AgentDeps`: `openai`, `temperature`, `cacheKey`,
`instructions`, `tools?`, `forkProfiles?`) — the agent imports no config or prompt
globals.

```ts
// one model call — streams `delta` to the bus while the model streams
step(args: StepArgs): Promise<StepResult>
// StepArgs   = { messages, options, profile?, bus, forbidTools? }
// StepResult = { outputText, outputParsed, toolCalls, items, usage }

// dispatch one tool call against the injected registry
executeTool(call, deps): Promise<string>
```

The **loop** is caller-owned: `runAgentLoop`
([src/runner/runner.ts](../src/runner/runner.ts)) is a plain `async` function that
drives one turn and **returns** `{ answer, items, usage }`:

```ts
runAgentLoop(args: RunAgentLoopArgs): Promise<TurnResult>
// RunAgentLoopArgs = { agent, messages, options, context, bus, maxToolSteps, profile? }
```

One iteration:

1. **`agent.step(...)`** — the runner passes `[...input, ...contextBlock]` (see
   [Memories](#memories-in-context)); text arrives as `delta` events on the bus, and
   the returned `StepResult` carries `toolCalls`, the produced transcript `items`,
   and `usage`.
2. **No tool calls** → format the answer with `formatResponse(step, options)`
   ([src/tools/format.ts](../src/tools/format.ts)) and return.
3. **Announce each call** as a `tool` event (`name`, `label`, `detail`) via
   `agent.toolMeta`.
4. **Approval gate** — for each call whose `approvalPolicy` requires it, emit
   `approval_request`, `await context.requestApproval(...)`, emit
   `approval_resolved`; a rejection records `APPROVAL_DENIED_OUTPUT` as that call's
   output. This is the tool-selection→invocation seam (12-factor Factor 08).
5. **Execute all calls concurrently** with `Promise.all(step.toolCalls.map(executeTool))`
   — results are collected in input order; each tool emits its own events to the bus
   as it runs.
6. **Append `function_call_output` items** and loop back to step 1.

`MAX_TOOL_STEPS` (injected as `maxToolSteps`) bounds the rounds: on the final allowed
round the request is re-issued with `forbidTools = true`, forcing the model to answer
with what it has. Requests use `store: false` and a stable `prompt_cache_key`; the
full `input` array is rebuilt and resent each step — the agent never relies on
server-side conversation state.

A tool that throws is caught by `executeTool` and its error returned as the
`function_call_output` string, so a tool failure never aborts the turn (the API
rejects a transcript with a dangling `function_call`; feeding the error back lets the
model recover).

## Events (UI-only) vs. the return value

Progress is observed through the **`EventBus`**
([src/agent/events/bus.ts](../src/agent/events/bus.ts)) — a small typed emitter with
one `subscribe(fn)` that receives every event, an `emit`, and `scoped(fork)`. It is
**injected and never persisted**: it exists purely so a front-end can watch a turn
unfold. The persisted message thread (Factor 05) stays the single source of truth,
and everything durable — the answer, the transcript `items`, token `usage` — is the
**return value** of `runAgentLoop`, not a bus event.

```ts
type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label?: string; detail?: string; fork?: string }
  | { type: "status"; text: string; fork?: string }
  | { type: "approval_request"; toolName: string; label?; detail?; reason?; risk? }
  | { type: "approval_resolved"; toolName: string; outcome: ApprovalOutcome };
```

`step()` emits `delta` _while_ the model streams (before it resolves), so
time-to-first-token is immediate. The Ink TUI subscribes to the bus and commits the
answer that `Session.runTurn` returns; a web server could drive the same `Agent` and
forward the bus over SSE.

## Tools are promises

The agent core ships **zero** tools. A tool is a `ToolDefinition`
([tools/types.ts](../src/agent/tools/types.ts)) whose `execute` is a plain async
function returning its result string. To report progress it emits on the injected UI
bus via `ctx.bus.emit(...)` — optional; most tools just `return`.

```ts
interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string; // UI verb, e.g. "Searching knowledge base"
  description: string; // sent to the model
  parameters: TArgs; // zod → strict JSON Schema
  execute: (args, ctx?) => Promise<string>;
  summarize?: (args) => string; // short UI detail, e.g. the query text
  requiresApproval?: boolean;
  approvalPolicy?: (args) => boolean | ApprovalNeed;
}
```

Implementations live in [src/tools/](../src/tools/); the host composes them in
`createAgentTools(store)` ([src/tools/index.ts](../src/tools/index.ts)) and injects
them via `AgentDeps`. Dispatch is a name lookup + zod-parse in
[agent/tools/index.ts](../src/agent/tools/index.ts). A round of calls runs
concurrently through `Promise.all`, which resolves the result strings in input order.
There is no per-tool special case in the loop.

Current tools: `get_weather_data`, `web_search`, `delegate_task`, `delegate_tasks`,
the disk set (`read_file`, `write_file`, `edit_file`), the HITL tools
(`ask_user`, `request_approval`), and the RAG set (`search_knowledge_base`,
`list_files`, `grep_files`, `read_source`).

## Model routing

Models are role-routed. The constants live in
[config/index.ts](../src/agent/config/index.ts):

| Constant             | Value         | Used by                                    |
| -------------------- | ------------- | ------------------------------------------ |
| `ORCHESTRATOR_MODEL` | `gpt-4o`      | the top-level assistant turn               |
| `FORK_MODEL`         | `gpt-4o-mini` | delegated sub-agents (forks)               |
| `CHEAP_MODEL`        | `gpt-4o-mini` | handoff compression + rolling summarizer   |
| `MODEL`              | `gpt-4o-mini` | base default when nothing else applies     |
| `TEMPERATURE`        | `0.7`         | injected into the `Agent`, sent every turn |

`buildRequestParams` resolves the request model by precedence
**`turnProfile.model ?? options.model`**:

- The **orchestrator** leaves `defaultProfile.model` unset, so `options.model` wins.
  `Session.effectiveTurnSettings` sets `options.model` to the store user-profile's
  `model`, defaulting to `ORCHESTRATOR_MODEL` — so the `/profile` model override
  still works, defaulting to `gpt-4o`.
- A **fork** sets `turnProfile.model = FORK_MODEL`, which wins via precedence.

`reasoningEffort` is optional on `TurnProfile`; when set, the request includes
`reasoning: { effort }` (a no-op on non-reasoning models like gpt-4o).

**Temperature is code-defined only.** It is not on `TurnOptions` (args) or the store
user-profile (setting) — it is injected into the `Agent` from the `TEMPERATURE`
constant at the composition root and sent on every turn. The handoff compressor,
summarizer, and reranker keep their own hardcoded temperatures.

## Memories in context

Persistent, per-profile notes (`/remember`; the store `memory` domain) ride in
`TurnContext.memories`. The **runner** — not the agent — renders them into a trailing
`developer` message via `buildContextBlock`
([context/context.ts](../src/context/context.ts)) and appends that block to the input
of every `agent.step` call; the agent itself is context-free and just sends the input
it is given. Memories are **numbered** `M1…Mn` via `keyMemories` inside a
`<user_known_memories>` block, with discretion rules (never volunteer them on
greetings/small talk; use only when directly relevant). The block is appended **last**
so a new memory never invalidates the cached prompt prefix above it.

The numbering exists so delegation can pass a **subset**: the orchestrator references
`M2`, and `delegate_task`/`delegate_tasks` resolve `relevantMemoryKeys` back to those
texts via `selectMemories` — a fork sees only the memories it needs. `Session`
fetches memories fresh per turn, so the indices are stable within a turn.

## Generalized sub-agent (delegation)

There is no bespoke sub-agent class. Delegation is **just tools** that recursively
call the same loop with a different `TurnProfile` — the same engine, swapped
instructions/tools/model. `ToolRunContext`
([conversation/turn.ts](../src/agent/conversation/turn.ts)) hands each tool the seam
it needs to recurse:

```ts
interface ToolRunContext {
  openai: OpenAI;
  context: TurnContext;
  messages: readonly ResponseInputItem[];
  runTurn: RunTurn; // === runAgentLoop, bound (object arg → Promise<TurnResult>)
  forkProfiles: ForkProfiles;
  bus: EventBus; // UI-only; runFork derives a scoped child from it
  recordUsage: (usage) => void; // reports nested LLM usage back to the turn total
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}
```

Both delegation tools live in [src/tools/delegation/](../src/tools/delegation/) and
share one core: `runFork`
([delegate-task.ts](../src/tools/delegation/delegate-task.ts)). `runFork`:

1. builds a self-contained brief from the parent conversation summary + the selected
   memories (`relevantMemoryKeys`) + the `task`;
2. resolves the fork profile (`ctx.forkProfiles[profile ?? "general"]`) into a
   `TurnProfile` — its instructions, `tools.map(toOpenAITool)` schemas, and
   `FORK_MODEL` — with a fresh per-fork cache key;
3. runs one child turn via `ctx.runTurn({ …, bus: ctx.bus.scoped(title) })` — the
   scoped bus tags the child's `tool`/`status` events with `fork: title` so the UI
   can nest them, and the child turn's transcript comes back as the returned `items`
   (never mixed into the parent's persisted transcript);
4. reports the child + handoff `usage` via `ctx.recordUsage`, compresses the child
   transcript into a structured `ForkResult` (below), and returns it.

- **`delegate_task`** runs one `runFork` and returns `JSON.stringify(forkResult)`.
  Params: `title`, `task`, `relevantMemoryKeys`, `profile`.
- **`delegate_tasks`** ([delegate-tasks.ts](../src/tools/delegation/delegate-tasks.ts))
  fans out `1..MAX_PARALLEL_TASKS` (6) independent tasks via
  `Promise.all(tasks.map(runFork))`, and returns a JSON **array** of `ForkResult` in
  task order. The hard cap is insurance against a single call spawning 15–20
  concurrent forks (each is an OpenAI request + a RAG-store load). The implicit path
  — the model emitting several single `delegate_task` calls in one round — stays
  unbounded and also runs in parallel (step 5 of the loop).

Neither delegation tool is available **to** forks, so forks can't fork.

### Fork profiles

A fork runs under a named profile. The name set is a single source of truth —
the tuple `FORK_PROFILE_NAMES` ([tools/types.ts](../src/agent/tools/types.ts)) —
from which the `ForkProfileName` type, the `ForkProfiles` map type, and the
`delegate_task` `profile` enum (`z.enum(FORK_PROFILE_NAMES)`) all derive:

```ts
export const FORK_PROFILE_NAMES = ["general", "rag_research"] as const;
export interface ForkProfile {
  instructions: string;
  tools: ToolDefinition<z.ZodType>[];
  model: string;
}
export type ForkProfiles = Record<ForkProfileName, ForkProfile>;
```

The concrete profiles are built in `createAgentTools` (it needs the `store` for the
RAG tools); their instruction prompts live in
[src/tools/prompts/](../src/tools/prompts/):

| Profile        | Instructions            | Tools                                                              |
| -------------- | ----------------------- | ------------------------------------------------------------------ |
| `general`      | `FORK_INSTRUCTIONS`     | `web_search`, `get_weather_data`                                   |
| `rag_research` | `RAG_FORK_INSTRUCTIONS` | `search_knowledge_base`, `list_files`, `grep_files`, `read_source` |

`rag_research` is for **multi-hop** retrieval — chained searches where one passage
guides the next; one-shot lookups stay as direct `search_knowledge_base` /
`read_source` calls from a `general` fork. `forkProfiles` is threaded
`AgentDeps → Agent → ToolRunContext`. `Agent` **flattens every profile's tools into
its dispatch registry** (`dedupe([...tools, ...Object.values(forkProfiles).flatMap(p => p.tools)])`)
so it can execute any call a fork makes — miss this and a fork's tool call dispatches
to a missing tool.

**Adding a profile** is two compiler-enforced edits: add the name to
`FORK_PROFILE_NAMES`, then add its entry to the `createAgentTools` map (TypeScript
errors on the map until you do, because `ForkProfiles` requires every key). The
type, enum, and empty default all update themselves.

### Structured handoff (`ForkResult`)

A fork's whole transcript is compressed into a strict schema
([delegation/fork-result.ts](../src/tools/delegation/fork-result.ts)) rather than
prose, so exact values survive:

```ts
const ForkResultSchema = z.object({
  summary: z.string(), // ≤80-word digest
  findings: z.array(z.object({ key: z.string(), value: z.string() })),
  sources: z.array(z.string()).nullable(),
  confidence: z.enum(["high", "low"]),
  needsFollowup: z.string().nullable(),
});
```

`compressHandoff` ([delegation/handoff.ts](../src/tools/delegation/handoff.ts)) makes
one `responses.parse` call (`CHEAP_MODEL`, `zodTextFormat(ForkResultSchema,
"fork_result")`) over the **full child transcript** — `function_call` and
`function_call_output` items included — so exact numbers/paths/IDs pulled from tool
outputs land verbatim in `findings` instead of being rounded into narrative. A
truncated (`status: "incomplete"`) or unparseable response falls back to a
low-confidence result with a sanitized summary. Only this digest (as JSON) re-enters
the parent's context, never the full sub-transcript.

## RAG touchpoint

RAG never touches the loop. It is exposed purely as store-backed tools
([src/tools/rag.ts](../src/tools/rag.ts)); the model decides when to call them, and a
multi-hop chain can be delegated to the `rag_research` fork. The retrieval pipeline
itself (ingest → hybrid fetch → rerank → filter) lives in the `sources` store domain
— see **[rag.md](./rag.md)** for the full reference.
