# Agent Loop

Hand-built agentic loop on the raw OpenAI Responses API — no framework. This is
the authoritative reference for how one turn runs, how the model is routed, how
memories reach the model, and how the generalized sub-agent (delegation +
structured handoff) works. For the surrounding layers see
[architecture.md](./architecture.md).

## The loop

`AgentService.run()` ([src/agent/agent.ts](../src/agent/agent.ts)) is a
**stateless** async generator — a pure function of its arguments that owns no
conversation state and mutates nothing outside the turn:

```ts
async *run(
  messages: readonly ResponseInputItem[],
  options:  TurnOptions   = DEFAULT_TURN_OPTIONS,
  context:  TurnContext   = EMPTY_CONTEXT,        // { memories }
  profile:  TurnProfile   = this.defaultProfile,  // { instructions, tools, cacheKey, model?, reasoningEffort? }
): AsyncGenerator<TurnEvent, void>
```

One iteration:

1. **Stream a model response** (`streamResponse`). Text arrives as `delta`
   events; token usage as a `usage` event. The final `ParsedResponse` is the
   generator's `return` value.
2. **Check for tool calls** (`hasFunctionCalls`). None → emit the final `message`
   items and an `answer`, then finish.
3. **Replay the assistant's tool-call items** into `input` and emit each as a
   `message` event (so persistence records them).
4. **Announce each call** as a `tool` event (`name`, `label`, `detail`).
5. **Execute all calls concurrently** via `mergeGenerators`
   ([events/merge.ts](../src/agent/events/merge.ts)) — their events interleave
   into the stream while their string results are collected in input order.
6. **Append `function_call_output` items** and loop back to step 1.

`MAX_TOOL_STEPS` bounds the rounds: on the final allowed round the request is
re-issued with `forbidTools = true`, forcing the model to answer with what it has
instead of calling more tools. Requests use `store: false` and a stable
`prompt_cache_key`; the full `input` array is rebuilt and resent each step — the
agent never relies on server-side conversation state.

A tool that throws is caught and its error returned as the `function_call_output`
string, so a tool failure never aborts the turn (the API rejects a transcript
with a dangling `function_call`; feeding the error back lets the model recover).

## Events

`run()` yields a plain, serializable union — the only contract between the core
and any front-end ([events/events.ts](../src/agent/events/events.ts)):

```ts
type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label?: string; detail?: string; fork?: string }
  | { type: "status"; text: string; fork?: string }
  | { type: "answer"; content: string }
  | { type: "message"; item: ResponseInputItem }
  | { type: "usage"; kind: "response" | "summarizer"; usage: ResponseUsage | undefined };
```

`delta`/`tool`/`status`/`answer` are for display; `message`/`usage` are the
ownership handoff — because the agent keeps no state, it hands every new
transcript item and usage record to its caller through these events. The Ink TUI
consumes the stream; a web server could drive the same `AgentService` and forward
it over SSE.

## Tools are streams

The agent core ships **zero** tools. A tool is a `ToolDefinition`
([tools/types.ts](../src/agent/tools/types.ts)) whose `execute` is itself an
async generator, so a tool can stream `status`/`tool` events while it runs and
`return` its result string:

```ts
interface ToolDefinition<TArgs extends z.ZodType> {
  name: string;
  label: string; // UI verb, e.g. "Searching knowledge base"
  description: string; // sent to the model
  parameters: TArgs; // zod → strict JSON Schema
  execute: (args, ctx?) => AsyncGenerator<TurnEvent, string>;
  summarize?: (args) => string; // short UI detail, e.g. the query text
}
```

The host composes them in `createAgentTools(store)`
([integration/tools/index.ts](../src/integration/tools/index.ts)) and injects
them via `AgentConfig`. Dispatch is a name lookup + zod-parse in
[tools/index.ts](../src/agent/tools/index.ts). A round of calls runs concurrently
through `mergeGenerators`, which interleaves their yielded events and resolves
their return strings in input order — a thin bridge captures each generator's
return value (`it-merge` only merges yielded values). There is no `emit`
callback and no per-tool special case in the loop.

Current tools: `get_weather_data`, `web_search`, `delegate_task`,
`delegate_tasks`, and the RAG set (`search_knowledge_base`, `list_files`,
`grep_files`, `read_file`).

## Model routing

Models are role-routed. The constants live in
[config/index.ts](../src/agent/config/index.ts):

| Constant             | Value         | Used by                                   |
| -------------------- | ------------- | ----------------------------------------- |
| `ORCHESTRATOR_MODEL` | `gpt-4o`      | the top-level assistant turn              |
| `FORK_MODEL`         | `gpt-4o-mini` | delegated sub-agents (forks)              |
| `CHEAP_MODEL`        | `gpt-4o-mini` | handoff compression + rolling summarizer  |
| `MODEL`              | `gpt-4o-mini` | base default when nothing else applies    |
| `TEMPERATURE`        | `0.7`         | every main turn (code-defined, see below) |

`buildRequestParams` resolves the request model by precedence
**`turnProfile.model ?? options.model`**:

- The **orchestrator** leaves `defaultProfile.model` unset, so `options.model`
  wins. `Session.effectiveTurnSettings` sets `options.model` to the store
  user-profile's `model`, defaulting to `ORCHESTRATOR_MODEL` — so the `/profile`
  model override still works, defaulting to `gpt-4o`.
- A **fork** sets `turnProfile.model = FORK_MODEL`, which wins via precedence.

`reasoningEffort` is optional on `TurnProfile`; when set, the request includes
`reasoning: { effort }` (a no-op on non-reasoning models like gpt-4o, plumbed for
when a reasoning model is configured for a profile).

**Temperature is code-defined only.** It is not on `TurnOptions` (args) or the
store user-profile (setting) — `buildRequestParams` always sends the `TEMPERATURE`
constant. The handoff compressor, summarizer, and reranker keep their own
hardcoded temperatures. Rationale: modern models are dropping the knob and it was
never surfaced in the `/profile` UI.

## Memories in context

Persistent, per-profile notes (`/remember`; the store `memory` domain) ride in
`TurnContext.memories` and are rendered into a trailing `developer` message by
`buildContextBlock` ([dynamicContext/context.ts](../src/agent/dynamicContext/context.ts)).
They are **numbered** `M1…Mn` via `keyMemories` inside a `<user_known_memories>`
block, with discretion rules (never volunteer them on greetings/small talk; use
only when directly relevant). The block is appended **last** so a new memory
never invalidates the cached prompt prefix above it.

The numbering exists so delegation can pass a **subset**: the orchestrator
references `M2`, and `delegate_task`/`delegate_tasks` resolve `relevantMemoryKeys`
back to those texts via `selectMemories` — a fork sees only the memories it needs,
not the whole set. `Session` fetches memories fresh per turn, so the indices are
stable within a turn.

## Generalized sub-agent (delegation)

There is no bespoke sub-agent class. Delegation is **just tools** that recursively
call the same `run()` loop with a different `TurnProfile` — the same engine,
swapped instructions/tools/model. `ToolRunContext`
([conversation/turn.ts](../src/agent/conversation/turn.ts)) hands each tool the
seam it needs to recurse:

```ts
interface ToolRunContext {
  openai: OpenAI;
  context: TurnContext;
  messages: readonly ResponseInputItem[];
  runTurn: RunTurn; // === AgentService.run, bound
  forkProfiles: ForkProfiles; // named fork profiles a delegation may run under
}
```

Both delegation tools live in the integration layer and share one core:
`runFork` ([integration/tools/delegate-task.ts](../src/integration/tools/delegate-task.ts)).
`runFork`:

1. builds a self-contained brief from the parent conversation summary + the
   selected memories (`relevantMemoryKeys`) + the `task`;
2. resolves the fork profile (`ctx.forkProfiles[profile ?? "general"]`) into a
   `TurnProfile` — its instructions, `tools.map(toOpenAITool)` schemas, and
   `FORK_MODEL` — with a fresh per-fork cache key;
3. runs one child turn via `ctx.runTurn(...)`, relabelling the child's
   `tool`/`status` events with `fork: title` so the UI can nest them, and
   swallowing the child's `message` items (its private transcript);
4. compresses the child transcript into a structured `ForkResult` (below) and
   returns it.

- **`delegate_task`** runs one `runFork` and returns `JSON.stringify(forkResult)`.
  Params: `title`, `task`, `relevantMemoryKeys`, `profile`.
- **`delegate_tasks`** ([delegate-tasks.ts](../src/integration/tools/delegate-tasks.ts))
  fans out `1..MAX_PARALLEL_TASKS` (6) independent tasks via `mergeGenerators`
  over `tasks.map(runFork)`, awaits all results, and returns a JSON **array** of
  `ForkResult` in task order. The hard cap is insurance against a single call
  spawning 15–20 concurrent forks (each is an OpenAI request + a RAG-store load).
  The implicit path — the model emitting several single `delegate_task` calls in
  one round — stays unbounded and also runs in parallel (step 5 of the loop).

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

The concrete profiles are built in `createAgentTools` (it needs the `store` for
the RAG tools):

| Profile        | Instructions            | Tools                                                            |
| -------------- | ----------------------- | ---------------------------------------------------------------- |
| `general`      | `FORK_INSTRUCTIONS`     | `web_search`, `get_weather_data`                                 |
| `rag_research` | `RAG_FORK_INSTRUCTIONS` | `search_knowledge_base`, `list_files`, `grep_files`, `read_file` |

`rag_research` is for **multi-hop** retrieval — chained searches where one
passage guides the next; one-shot lookups stay as direct `search_knowledge_base`
/ `read_file` calls from the main turn. `forkProfiles` is threaded
`AgentConfig → AgentService → ToolRunContext`. `AgentService` **flattens every
profile's tools into its dispatch registry**
(`dedupe([...tools, ...Object.values(forkProfiles).flatMap(p => p.tools)])`) so it
can execute any call a fork makes — miss this and a fork's tool call dispatches to
a missing tool.

**Adding a profile** is two compiler-enforced edits: add the name to
`FORK_PROFILE_NAMES`, then add its entry to the `createAgentTools` map (TypeScript
errors on the map until you do, because `ForkProfiles` requires every key). The
type, enum, and empty default all update themselves.

### Structured handoff (`ForkResult`)

A fork's whole transcript is compressed into a strict schema
([tools/utils/fork-result.ts](../src/agent/tools/utils/fork-result.ts)) rather
than prose, so exact values survive:

```ts
const ForkResultSchema = z.object({
  summary: z.string(), // ≤80-word digest
  findings: z.array(z.object({ key: z.string(), value: z.string() })),
  sources: z.array(z.string()).nullable(),
  confidence: z.enum(["high", "low"]),
  needsFollowup: z.string().nullable(),
});
```

`compressHandoff` ([tools/utils/handoff.ts](../src/agent/tools/utils/handoff.ts))
makes one `responses.parse` call (`CHEAP_MODEL`, `zodTextFormat(ForkResultSchema,
"fork_result")`) over the **full child transcript** — `function_call` and
`function_call_output` items included — so exact numbers/paths/IDs pulled from
tool outputs land verbatim in `findings` instead of being rounded into narrative.
It falls back to a low-confidence result if parsing returns null. Only this digest
(as JSON) re-enters the parent's context, never the full sub-transcript.

## RAG touchpoint

RAG never touches the loop. It is exposed purely as store-backed tools
([integration/rag/tools.ts](../src/integration/rag/tools.ts)); the model decides
when to call them, and a multi-hop chain can be delegated to the `rag_research`
fork. The retrieval pipeline itself (ingest → hybrid fetch → rerank → filter)
lives in the `sources` store domain — see **[rag.md](./rag.md)** for the full
reference.

```

```
