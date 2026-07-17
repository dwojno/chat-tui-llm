# Agent Loop

A hand-built agentic loop on the raw OpenAI Responses API — no framework. This is the
authoritative reference for how one turn runs. The surrounding layers are in
[architecture.md](./architecture.md); persistence in [database.md](./database.md).

The whole design collapses to one idea:

> **The agent is a pure reducer over an owned, serializable event log.**

That single sentence buys full control of the context window, a stateless core,
self-healing tool use, and clean pause/resume + trigger seams — see the
[design principles](#design-principles) it rests on.

## Mental model

An LLM is a stateless function: `input → output`. So a turn is a fold — reduce the
history you own into an input, ask for one decision, append the result, repeat:

```
        ┌───────────────────── the runner owns this ─────────────────────┐
        │                                                                 │
 events ┼──▶ reduce(events, memories)  ──────────▶  Agent.step(input)  ──┼──▶ tool calls
(state) │        └ fold → ONE                       └ pure: SDK in,       │      or text
        │          custom-format <user> message       decision out        │        │
        │                                                                 │        ▼
        └────────────  append AgentEvent(s)  ◀── run tools / answer ◀─────┘   AgentEvent[]
```

Three parts, each with one job:

| Part                              | Owns                                | Doesn't own                        |
| --------------------------------- | ----------------------------------- | ---------------------------------- |
| **`AgentEvent[]`** (the log)      | the entire turn state, serialized   | —                                  |
| **reducer** (`app/runner/thread`) | `events → prompt`, error compaction | I/O, the model, windowing          |
| **`Agent`** (`agent/`)            | one model call, one tool dispatch   | the loop, the log, context, config |

## The event log is the state

Everything durable is an `AgentEvent` in one append-only log
([app/runner/thread/events.ts](../src/app/runner/thread/events.ts)). The SDK's
`ResponseInputItem` is no longer the domain type — it survives only at the model
boundary.

```ts
type AgentEvent =
  | { type: "user_message"; content: string }
  | { type: "tool_call"; id; name; args } // a native call the model made
  | { type: "tool_result"; id; name; output }
  | { type: "error"; id; name; message } // a COMPACTED failure
  | { type: "approval_request"; id; name; reason?; risk? }
  | { type: "approval_response"; id; outcome }
  | { type: "clarification_request"; question; options? }
  | { type: "human_response"; content }
  | { type: "assistant_answer"; content; sources? } // the terminal answer
  | { type: "summary"; content } // a rolling-summary segment (see Windowing)
  | { type: "scratchpad"; ops }; // a working-memory mutation (see Scratchpad)
```

Because the log **is** the state, there is no separate snapshot format: persist the
events, and any future caller (a webhook, a cron, a Slack reply) can rehydrate and
continue by appending the next event and re-running the reducer. Human-layer
requests/responses are events too, so the transcript is complete and auditable.

## Own your context window

The reducer ([app/runner/thread/reducer.ts](../src/app/runner/thread/reducer.ts)) folds the
log into **one packed `<user>` message** — a custom, token-efficient format, not a raw
role array. Each event renders as an XML-tagged block; a tool call is `<{intent}>`, its
result `<{intent}_result>`:

```
buildMessage({ events, memories }) -> ResponseInputItem[]   // length-1: one user message

  <events>
    <conversation_summary>…</conversation_summary>   ← summary segments (events) lead the list

    <user_message>weather in Paris and Tokyo?</user_message>

    <get_weather_data>
      intent: "get_weather_data"
      city: "Paris"
    </get_weather_data>

    <get_weather_data_result>
      The weather in Paris is sunny
    </get_weather_data_result>
  </events>
  <context> …<user_known_memories> M1: … </user_known_memories>… </context>   ← appended LAST
  <scratchpad> <todo> - [x] check Paris … </todo> </scratchpad>   ← derived working state
  <next_step>Choose the next step: call tools, ask, or answer.</next_step>
```

Summaries are just `summary` events in the log (see [Windowing](#windowing)), so the
reducer takes only `events` + `memories` — there's no separate summary channel. Data
renders as YAML via a tiny dependency-free serializer
([yaml.ts](../src/app/runner/thread/yaml.ts)), keeping the "frameworkless" claim intact.

**Ordering is deliberate — it protects the prompt cache.** Summary segments lead (they
only change when a new one is minted), messages append-only, memories **last** (so a
`/remember` never invalidates the cached prefix above it), fixed framing suffix. The
render is deterministic — no ids or timestamps leak into the text — so the leading
token run is byte-stable step to step and `prompt_cache_key` keeps paying off.

The agent's `step()` still **accepts a `ResponseInputItem[]`** and responds with native
SDK output items. `buildMessage` produces that one reduced message once per turn — the
**frozen seed** (cross-turn history + summary + memories). The runner then sends
`[seed, ...liveItems]`, where `liveItems` accumulates the **raw SDK output items**
(reasoning + function_call) of each step plus a `function_call_output` for every call.

**Why raw items, not more packed text — reasoning continuity.** The orchestrator is a
reasoning model, and the Responses API only lets a reasoning model resume its
chain-of-thought across a tool round-trip if its `reasoning` items are passed back
verbatim (paired with their `function_call`, followed by the call's output — a dangling
reasoning item is a 400). With `store: false` we opt in via
`include: ["reasoning.encrypted_content"]` and thread the returned items forward. Without
this a reasoning model loses its thread between steps and can loop — re-issuing the same
(idempotent) tool call until the step cap forces a degraded answer. The seed stays frozen
and `liveItems` is append-only, so the whole prefix is byte-stable and the prompt cache
keeps paying off. Every `function_call` is answered — real tools return their output,
`update_scratchpad` and control intents get a synthesized one — so nothing dangles. The
durable `AgentEvent` log is still written in parallel; `liveItems` is ephemeral, never
persisted, and rebuilt from the seed each turn.

## Windowing

The log can't grow forever, so it's bounded by **summary segments**. After each turn, if
the un-summarized tail (messages since the last summary) exceeds `KEEP_LAST_TURNS` (4),
the whole tail is folded into a single new `summary` event and appended — a checkpoint,
not a rewrite (`maintainWindow`, [session.ts](../src/app/session/session.ts)).

`forModel()` then returns **every summary segment, then the messages after the last
one** — so nothing is dropped as the window slides: evicted turns are represented by
their segment, recent turns stay verbatim.

```
log:    m1  m2  m3  [S1]  m4  m5  [S2]  m6      ← append-only; segments interleave by time
model:            [S1]         [S2]  m6         ← S1,S2 stand in for m1–m5; m6 verbatim
```

Because segments are appended (never mutated) and `forModel()` cuts at the _last_
segment, the model view is always complete and the cached prefix only shifts when a new
segment is minted. Older segment rows are also the audit trail.

## Primitives vs. the loop

The `Agent` ([agent.ts](../src/agent/agent.ts)) is **stateless**, owns **no loop**, and
imports no config, prompt, or event type — every collaborator is injected via
`AgentDeps`. It knows nothing about `AgentEvent` or the reducer.

```ts
// one model call — streams `delta` to the bus while the model streams
step(args): Promise<{ outputText, outputParsed, toolCalls, usage }>
// dispatch one tool against the injected registry; a throw is caught → "Error: …"
executeTool(call, deps): Promise<string>
```

The **loop** is a plain async function the caller owns
([runner.ts](../src/app/runner/runner.ts)):

```ts
runAgentLoop({ agent, events, options, context, bus,
               maxToolSteps, maxConsecutiveErrors, profile? })
  : Promise<{ answer, events, usage }>       // events = only the NEW events this turn
```

One iteration:

```
input   = buildMessage(events, context.memories)              // the reducer
step    = agent.step(input, tools)                            // native tool-calling kept
switch on step:
  done_for_now  ─▶ append assistant_answer, RETURN            ┐ reserved control
  request_more_information ─▶ ask human, append q+a, loop     ┘ intents (by name)
  work tool calls ─▶ approval gate ─▶ Promise.all(executeTool)
                    append tool_call + (tool_result | error), loop
  plain text ─▶ append assistant_answer, RETURN               // streamed → fast TTFT
repeat, bounded by maxToolSteps (final round forces tools:[] → a text answer)
```

`store: false` and full replay each step: the app owns the whole window and never leans
on server-side conversation state.

## Hybrid: native tools + control intents

Owning the _input_ and owning _how the model acts_ are independent axes. We own the
input (custom format) but keep **native tool-calling** for actions — so the model can
fire several tools in one turn (executed in parallel via `Promise.all`), the final
answer still streams token-by-token, and delegation/approval are untouched.

"Intents" enter the loop as two **reserved control tools**
([app/tools/control-intents.ts](../src/app/tools/control-intents.ts)) the runner _interprets_
by name instead of dispatching:

| Intent                     | Carries                | Effect                                     |
| -------------------------- | ---------------------- | ------------------------------------------ |
| `done_for_now`             | `answer`, `sources?`   | terminate with a structured/sourced answer |
| `request_more_information` | `question`, `options?` | run the clarification gate, then continue  |

A plain text reply (no tool call) is also a valid terminal — it streams, so it's the
fast path; `done_for_now` is for answers that need explicit sources. Malformed/truncated
intent arguments don't crash the turn: the runner records a compact `error` event and
lets the model self-heal (below).

## Scratchpad: a derived-state action

The `update_scratchpad` tool ([app/tools/scratchpad.ts](../src/app/tools/scratchpad.ts)) is
the agent's private working memory across steps — a todo list, a discovery plan, interim
findings. Like the control intents it is **interpreted by name, never dispatched**: the
runner pulls scratchpad calls out of the work set, folds each into a `scratchpad` event,
and — because updating the plan is progress, not an answer — a scratchpad-only step
`continue`s the loop rather than terminating.

It is a second reducer over the same log. Ops are generic named sections
(`{ section, content }`, `content: null` clears one), and `deriveScratchpad(events)` folds
them last-write-wins per section into the current state the reducer renders as
`<scratchpad>` — placed after `<context>`, before `<next_step>`, so the agent sees its
plan right as it chooses the next step. The raw `scratchpad` events are **suppressed from
the transcript** (`eventToPrompt` returns `null`, exactly like approval bookkeeping) — only
the folded state is shown, so a growing stream of "I edited the todo" calls never clutters
context. To mark a todo done the model rewrites the whole section with the item checked;
there is no per-item op, keeping the fold trivial and desync-free.

State is folded only from the windowed events (`forModel()`), so the scratchpad reliably
persists within `KEEP_LAST_TURNS` — deliberately temporary working memory, not durable
storage. It rides the orchestrator only; forks stay lean.

**A turn's scratchpad is reset as it returns, not carried whole into the next.** When the
runner finishes a turn (`finish`), it appends one synthetic `scratchpad` event computed by
`scratchpadResetOps`: every section is trimmed to its still-open (`- [ ]`) todo items, and
anything else — checked-off todos, spent plans, interim findings — is cleared
(`content: null`). This is deterministic and happens in code, not left to the model to
remember: an unfinished task resumes cleanly next turn (its open items survive), while a
finished task doesn't leak its findings or done checklist into an unrelated follow-up. The
cleared state is persisted and emitted to the UI, so the panel reflects it immediately.

## Compact errors → self-healing

A tool that throws is caught by `executeTool` and returned as a compact `"Error: …"`
string; the runner turns that into an `error` event (message only, no stack). The model
reads the error on the next step and adjusts.

State is **derived**, never mutated — `deriveControl(events)` folds the trailing run of
`error` events into `consecutiveErrors`, which resets automatically on any success or
human response:

```ts
deriveControl(events) -> { consecutiveErrors }   // trailing errors since the last
                                                 // tool_result / user_message / human_response
```

- **Prune resolved errors** — the reducer drops an `error` from the prompt once the same
  tool later succeeds (kept in the durable log for audit). The window stays dense.
- **Escalate, don't spin** — at `maxConsecutiveErrors` (3), _if_ a human is reachable,
  the runner appends a `clarification_request` and asks how to proceed; unattended, it
  simply runs to the `maxToolSteps` cap. Either way it can't loop forever.

### Deterministic guardrails

Prompts _steer_ the model; guardrails _enforce_. At the work-call dispatch seam
(`dispatchWork`) the runner applies two turn-scoped, deterministic rules — each fork's own
loop gets its own state, so a fork can't spin either:

- **Duplicate-call suppression** — a call keyed by `name` + `canonicalizeArgs(args)` that
  already succeeded this turn reuses the memoised output instead of re-executing (identical
  calls in one round collapse to a single execution too). This is what would have killed the
  demo's triple `read_source`. The `tool_call` event is still recorded, so the model's
  behaviour stays observable (and measurable in evals); only re-execution is skipped.
- **Per-call error circuit-break** — the same call may error `MAX_CALL_RETRIES` (2) times
  before it's cut off with a terminal note, rather than being retried to the step cap.

Only exact, provable-bad cases are enforced (errors are never memoised, so a genuine
retry-after-failure still runs); fuzzy cases — near-duplicate but non-identical work — stay
the prompt's job so a guardrail never misfires.

## Streaming vs. durable — the bus is UI-only

Progress rides the injected **`EventBus`** ([events/bus.ts](../src/agent/events/bus.ts));
durable data rides the **return value**. The bus is never persisted.

```ts
type TurnEvent =
  | { type: "delta"; text }                       // streamed while the model streams
  | { type: "tool"; name; label?; detail?; fork? }
  | { type: "status"; text; fork? }
  | { type: "approval_request" | "approval_resolved"; … };
```

The answer has two sinks from one model response: streamed `delta`s for the UI, and the
`assistant_answer` event for the store. A plain-text answer streams token-by-token; a
`done_for_now` answer arrives on commit (its args aren't text deltas). The Ink TUI
subscribes to the bus; a web server could forward the same stream over SSE.

## Model routing

Role-routed via constants ([config.ts](../src/app/config.ts)):

| Constant                                    | Value          | Used by                                       |
| ------------------------------------------- | -------------- | --------------------------------------------- |
| `ORCHESTRATOR_MODEL`                        | `gpt-5.6-luna` | the top-level turn (a reasoning model)        |
| `FORK_MODEL`                                | `gpt-4.1-nano` | delegated sub-agents                          |
| `SUMMARIZER_MODEL`                          | `gpt-4.1-nano` | rolling summarizer                            |
| `HANDOFF_MODEL`                             | `gpt-4.1-nano` | fork-result (handoff) compression             |
| `TEMPERATURE`                               | `0.7`          | injected into the `Agent`; non-reasoning only |
| `MAX_TOOL_STEPS` / `MAX_CONSECUTIVE_ERRORS` | `8` / `3`      | loop bounds, injected into `runAgentLoop`     |

`buildRequestParams` resolves the model by `profile.model ?? options.model`: the
orchestrator leaves `profile.model` unset so the `/profile` override (or
`ORCHESTRATOR_MODEL`) wins; a fork sets `profile.model = FORK_MODEL`. **Temperature is
code-defined only** — not on `TurnOptions` or the user profile — and `buildRequestParams`
omits it for reasoning models (`gpt-5` family, `o`-series), which reject the param.

## Memories in context

Per-profile notes (`/remember`) ride in `TurnContext.memories`; the **reducer** — not
the agent — numbers them `M1…Mn` (`keyMemories`) inside `<user_known_memories>` with
discretion rules (never volunteer on small talk). The numbering lets delegation pass a
**subset**: `delegate_task` resolves `relevantMemoryKeys` → texts via `selectMemories`,
so a fork sees only what it needs.

## Generalized sub-agent (delegation)

No bespoke sub-agent class — delegation is **just tools** that recursively call the same
loop with a different `TurnProfile`. The recursion seam is `ToolRunContext.runTurn`
([conversation/turn.ts](../src/agent/conversation/turn.ts)), which stays **SDK-typed**
(`messages` in, `items` out) so `agent/` never imports the event type and there's no
import cycle. The runner **bridges** at that boundary via
[convert.ts](../src/app/runner/thread/convert.ts) — SDK items ⇄ events — while working in
events internally.

`runFork` ([delegate-task.ts](../src/app/tools/delegation/delegate-task.ts)):

1. builds a self-contained brief from the selected memories (`relevantMemoryKeys`) + the `task`;
2. resolves the fork profile into a `TurnProfile` (instructions, tool schemas,
   `FORK_MODEL`, fresh cache key);
3. runs one child turn via `ctx.runTurn({ …, bus: ctx.bus.scoped(title) })` — the scoped
   bus tags the child's events with `fork: title`; the child transcript never mixes into
   the parent's persisted log;
4. reports nested `usage`, compresses the child into a structured `ForkResult`, returns.

- **`delegate_task`** → one fork.
- **`delegate_tasks`** → `1..MAX_PARALLEL_TASKS` (6) forks via `Promise.all`, returning a
  `ForkResult[]`. Forks get neither delegation tool — they can't fork.

### Fork profiles

A fork runs under a named **specialist** profile. Profiles are **app configuration**, not
agent core: the agent takes an opaque `ForkProfiles = Record<string, ForkProfile>` and knows
none of the concrete names. The registry `FORK_PROFILE_META`
([app/tools/delegation/profiles.ts](../src/app/tools/delegation/profiles.ts)) is the single
source of truth — each entry carries the specialist's menu `description`, `instructions`, and
`tools(store)` factory. Both `createAgentTools` (the wiring) and the shared `profileArg` (the
`delegate_task`/`delegate_tasks` `profile` menu the model sees) derive from it, so adding a
specialist is one entry there.

| Profile        | Instructions                 | Tools                                                              |
| -------------- | ---------------------------- | ------------------------------------------------------------------ |
| `general`      | `FORK_INSTRUCTIONS`          | `web_search`, `get_weather_data` — the simple-one-off fallback     |
| `rag_research` | `RAG_FORK_INSTRUCTIONS`      | `search_knowledge_base`, `list_files`, `grep_files`, `read_source` |
| `web_research` | `WEB_FORK_INSTRUCTIONS`      | `web_search` — thorough, cross-checked, cited                      |
| `codebase`     | `CODEBASE_FORK_INSTRUCTIONS` | `read_file` — reads working-dir files at paths named in the brief  |

The orchestrator prompt's principle is **prefer the specialist whose focus matches the
sub-task; fall back to `general` only for a simple one-off** — the prompt never enumerates the
profiles, it points at the `profile` menu. `Agent` flattens every profile's tools into its
dispatch registry, so it can execute any call a fork makes. Each specialist prompt carries a
stop-condition ("never re-read what you've already read; stop once the brief is answerable")
so a fork doesn't loop on redundant retrieval.

### Structured handoff (`ForkResult`)

A fork's whole transcript is compressed into a strict schema
([fork-result.ts](../src/app/tools/delegation/fork-result.ts)) rather than prose, so exact
values survive:

```ts
ForkResultSchema = z.object({
  summary: z.string(), // ≤80-word digest
  findings: z.array(z.object({ key, value })), // exact numbers/paths/IDs verbatim
  sources: z.array(z.string()).nullable(),
  confidence: z.enum(["high", "low"]),
  needsFollowup: z.string().nullable(),
});
```

`compressHandoff` makes one `responses.parse` call (`HANDOFF_MODEL`) over the full child
transcript; a truncated/unparseable response falls back to a low-confidence result. Only
this digest re-enters the parent's context.

## Pause / resume / trigger seams

Not implemented — but the design makes them a small, localized addition, and that's the
point of putting all state in the log:

- `runAgentLoop({ events }) → { events }`: the full resumable state is the event list. A
  future pause returns early with a pending `*_request` event already appended; resume
  re-runs over the persisted log plus the `*_response` event. No new state format.
- `Session.runTurn(prompt)` is already "load the log → append a `user_message` → reduce →
  persist". A future Slack/cron/webhook adapter calls the same path with a different
  triggering event.
- The pause point is the tool-selection→execution seam (the approval gate) — the exact
  seam most orchestrators _can't_ pause at, and which this frameworkless loop owns.

## RAG touchpoint

RAG never touches the loop — it's exposed purely as store-backed tools; the model
decides when to call them, and multi-hop chains delegate to the `rag_research` fork. See
**[rag.md](./rag.md)**.

## Design principles

The whole loop falls out of a handful of decisions I committed to up front:

| Principle                                                          | Where it lives                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Own the context window** — no default role array                 | the reducer folds the log into one custom-format message     |
| **One log is the whole state** — no split execution/business state | the append-only `AgentEvent` log                             |
| **Own the control flow** — no framework driving the loop           | `runAgentLoop` is a plain caller-owned function              |
| **Compact errors into context** — failures teach the model         | `error` events + derived counter + prune-resolved + escalate |
| **The core is a stateless reducer** — `reduce → decide → append`   | the `Agent` retains nothing between turns                    |
| **Resumable by construction** — the log _is_ the snapshot          | pause/resume + trigger-anywhere as clean seams               |
