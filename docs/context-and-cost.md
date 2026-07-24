# Context, tokens & cost

**How chat-cli controls what the model sees, minimizes what it sends, and tracks what
it costs — in one place.**

The story of context-window management, token saving, and cost tracking is spread across
[agent-loop.md](agent-loop.md), [architecture.md](architecture.md), [database.md](database.md),
[observability.md](observability.md), and [rag.md](rag.md). This doc pulls it together and
pins the real numbers. Every constant and price below is taken from source, not prose — where
it disagrees with another doc, the source wins.

---

## The one lever

The three themes are not three mechanisms — they are one. Each turn, the reducer
([`packages/engine/src/thread/reducer.ts`](../packages/engine/src/thread/reducer.ts)) folds the owned
`AgentEvent` log into **one packed `<user>` message**, in a fixed, deterministic order:

```
   <events>       summary segments first, then append-only messages / tool calls / results
   <context>      memories M1…Mn, numbered, with rules for using them   ← pinned LAST
   <scratchpad>   the agent's private plan / findings (derived)
   <next_step>    choose the next step: call tools, ask, or answer
```

That single ordering does all three jobs at once:

- **Context management** — summary segments stand in for evicted turns; recent turns stay verbatim.
- **Token saving** — a custom, token-dense format instead of a verbose role array; resolved errors pruned.
- **Cost** — the leading token run is **byte-stable step to step**, so the `prompt_cache_key`
  prefix keeps paying off (cached input is ~10× cheaper — see the price table). A `/remember`
  changes only the tail and never invalidates the cached prefix above it.

Prompt caching is the biggest cost lever, and ordering _is_ the cache strategy.
→ [agent-loop.md](agent-loop.md), [architecture.md](architecture.md).

---

## Context-window management

The append-only `AgentEvent` log **is** the turn state — there is no separate snapshot. The
window is bounded not by dropping rows but by summarizing them.

```
turns:  1  2  3  4  5 … 26 27 28 29 30   (newest)
        └──── folded into a summary ───┘ └── last 4 kept verbatim ──┘
        summary + recent turns  =  a stable, cacheable prompt prefix
```

- **Eviction is summarization.** After a turn, `maintainWindow` ([`apps/cli/src/session/session.ts`](../apps/cli/src/session/session.ts))
  reads the un-summarized tail (`afterLastSummary()`); if it holds more than `KEEP_LAST_TURNS`
  (**4**) user turns, the whole tail is folded into one new `summary` segment via `summarize`
  ([`packages/engine/src/tokens/summarizer.ts`](../packages/engine/src/tokens/summarizer.ts)) and **appended**.
- **Segments are never rewritten.** Each `kind = 'summary'` row covers the slice between it and
  the previous summary. `forModel()` returns **every summary segment plus the messages after the
  last one**, so evicted turns are always represented, never lost, and the view survives a
  restart. → [database.md](database.md).
- **Scratchpad resets on finish.** The `<scratchpad>` block is a second fold over the same log
  (`deriveScratchpad`). On turn finish, everything but still-open `- [ ]` todo items is cleared,
  so spent findings and checked-off checklists never leak into an unrelated follow-up.
- **Memories are pinned last.** Per-profile `/remember` notes ride in the tail as `M1…Mn`, so
  adding one never disturbs the cached prefix above. → [agent-loop.md](agent-loop.md).

---

## Token saving

Everything here reduces **input tokens** — the dominant, repeated cost of an agent loop.

- **Custom packed message, not a role array.** The reducer renders events as compact XML-tagged
  blocks (a tool call is `<web_search>`, its result `<web_search_result>`) instead of a verbose
  multi-message role array.
- **Resolved errors are pruned.** A thrown tool becomes a compact `<error>` event (message only,
  no stack). Once the same tool later succeeds, `pruneResolvedErrors` drops the error from the
  prompt — kept in the durable log for audit, gone from context. The window stays dense.
- **Duplicate calls are suppressed.** A call keyed by `name` + canonicalized args that already
  succeeded this turn reuses the memoized output instead of re-executing — no redundant tool
  output re-enters context.
- **Answers stream.** A plain-text answer streams token-by-token for fast time-to-first-token;
  the durable `assistant_answer` event is written in parallel. The streaming EventBus is UI-only,
  never persisted.
- **Delegation returns a digest, not a transcript.** A fork's whole transcript is compressed by
  `compressHandoff` into a structured `ForkResult` (≤80-word summary + exact `findings`), and
  **only that digest re-enters the parent's context**. Forks also receive only the subset of
  memories (`relevantMemoryKeys`) they need. → [agent-loop.md](agent-loop.md).
- **RAG tightens retrieved context.** Retrieval over-fetches, LLM-reranks, drops hits below
  `RAG_RELATIVE_CUTOFF` (0.5) of the top score, and caps each snippet at `RAG_SNIPPET_MAX_CHARS`
  (≈1200 chars ≈ one whole 512-token chunk) — fewer, complete passages beat many partial ones.
  → [rag.md](rag.md).

---

## Cost management

- **Model-role routing.** Only the orchestrator turn runs the expensive reasoning model; every
  supporting role runs cheap `gpt-4.1-nano`:

  | Role                | Model                      | Where                |
  | ------------------- | -------------------------- | -------------------- |
  | Orchestrator turn   | `gpt-5.6-luna` (reasoning) | `ORCHESTRATOR_MODEL` |
  | Sub-agent forks     | `gpt-4.1-nano`             | `FORK_MODEL`         |
  | Rolling summarizer  | `gpt-4.1-nano`             | `SUMMARIZER_MODEL`   |
  | Handoff compression | `gpt-4.1-nano`             | `HANDOFF_MODEL`      |
  | Eval probes         | `gpt-4o-mini`              | `EVAL_PROBE_MODEL`   |

- **Usage is real, never estimated.** Token counts come from the model response via the
  [`Model`](../packages/platform/src/model/index.ts) adapter (`Model.fromOpenAI` / later
  `fromAnthropic`). Each call harvests `{ inputTokens, cachedInputTokens, outputTokens, model, kind }`
  into `usage_record` when a session binds `withUsageRecorder`. Totals are `SUM()` over that
  table — not estimated, not on transcript rows. → [database.md](database.md).
- **Pricing** lives in [`packages/platform/src/telemetry/pricing.ts`](../packages/platform/src/telemetry/pricing.ts),
  USD per **1M** tokens. `estimateCost` charges `uncachedInput = max(0, input − cached)` at the
  input rate, cached tokens at the (much lower) cached rate, and output at the output rate:

  | Model          | input | cached | output |
  | -------------- | ----- | ------ | ------ |
  | `gpt-5.6-luna` | 1.0   | 0.1    | 6.0    |
  | `gpt-4.1-nano` | 0.1   | 0.025  | 0.4    |
  | `gpt-4o-mini`  | 0.15  | 0.075  | 0.6    |

- **Observability.** Each model round records `gen_ai.usage.{input,output,cached_input}_tokens`
  and `gen_ai.usage.cost` (USD, from the table above), plus token/cost counters and a TTFT
  histogram, over OTel → OTLP. → [observability.md](observability.md).

### The exit report — proof of the savings

On exit, [`apps/cli/src/session/usage.ts`](../apps/cli/src/session/usage.ts) prints a **Context report** that
contrasts what was actually sent against a naive "re-send everything every turn" baseline:

```
Context report — 12 turns
  Input sent (actual):     18,430 tok
    └ served from cache:   14,110 tok (77%)
    └ fork / handoff:       3,200 tok
  Summarizer overhead:      1,240 tok
  Naive append-all input:  96,880 tok
  Saved vs naive:          80,410 tok (83%)
  Output generated:         6,050 tok
```

The math compares like with like:

- `managedInput` estimates each parent call's packed prompt using summaries and recent events,
  exactly as `buildMessage` constructs it.
- `baselineInput` estimates the same calls with every summary removed and the full raw history
  retained. Both use `estimateTokens = Math.ceil(chars / 4)` and include the system prompt.
- `saved = baselineInput − (managedInput + summarizer)`. Tool schemas and model-internal tokens are
  absent from both estimates, so their fixed overhead cancels instead of contaminating the delta.
- Real API totals remain under `Input sent (actual)`. Fork/handoff spend is real and shown there,
  but excluded from the context-strategy delta because fork transcripts never enter parent history;
  only their digests do.

Both estimates are reconstructed at read time in
[`apps/cli/src/backend/conversation/helpers.ts`](../apps/cli/src/backend/conversation/helpers.ts) `usageFromItems`, never
stored. One-turn conversations without summaries should report approximately zero saved.

A live one-line usage bar (`↑ in (cached) · ↓ out · total · N turns`) shows the running totals
during the session.

---

## Constants, in one table

The quick reference the scattered docs never gave. Values from
[`apps/cli/src/config.ts`](../apps/cli/src/config.ts) and
[`packages/tools/src/delegation/delegate-tasks.ts`](../packages/tools/src/delegation/delegate-tasks.ts).

| Constant                 | Value      | Role                                                | Source                   |
| ------------------------ | ---------- | --------------------------------------------------- | ------------------------ |
| `KEEP_LAST_TURNS`        | 4          | turns kept verbatim before summarization            | `apps/cli/src/config.ts` |
| `MAX_TOOL_STEPS`         | 8          | tool iterations per turn                            | `apps/cli/src/config.ts` |
| `MAX_CONSECUTIVE_ERRORS` | 3          | abort after N back-to-back tool errors              | `apps/cli/src/config.ts` |
| `MAX_PARALLEL_TASKS`     | 6          | `delegate_tasks` fan-out cap                        | `delegate-tasks.ts`      |
| `TEMPERATURE`            | 0.7        | non-reasoning turns only (summarizer uses 0.2)      | `apps/cli/src/config.ts` |
| `DEFAULT_CACHE_KEY`      | `chat-cli` | base of the per-process `chat-cli:${pid}` cache key | `apps/cli/src/config.ts` |

Temperature is sent only on non-reasoning turns; `buildRequestParams` omits it for reasoning
models (the `gpt-5` family and `o`-series), which reject the param.
