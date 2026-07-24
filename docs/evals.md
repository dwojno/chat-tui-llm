# Prompt evals

A frameworkless agent lives and dies by its prompts, so those get tested like
code. These are behavioural tests for the **prompts and tools** this app ships —
not the TypeScript, the prompts: does the model route to the right tool, stay
quiet about stored facts until asked, keep summaries short? Built on
[evalite](https://evalite.dev). Each eval drives a real prompt from the codebase
against the live model and scores what comes back.

```bash
just eval          # run once (evalite run)
just eval-watch    # watch + UI at http://localhost:3006
```

Requires a real `OPENAI_API_KEY` — loaded from `.env` via `setupFiles` in
[evalite.config.ts](../apps/cli/evalite.config.ts).

## What's covered

The CLI app owns the tests in [`suites/`](../apps/cli/evals/suites/); the reusable machinery lives in
[`harness/`](../apps/cli/evals/harness/); the runner config is [`evalite.config.ts`](../apps/cli/evalite.config.ts)
next to the CLI package.

```
apps/cli/evals/
  harness/        the machinery (imported via `../harness`)
    probe.ts      the task: one model turn → observable result
    scorers/      scorers that grade a result against `Expected`
    client.ts     shared lazy OpenAI client
    index.ts      barrel — suites import from here
  suites/         the tests, one *.eval.ts per prompt
```

| Suite                               | Prompt under test                               | Scores                                                                                                       |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `suites/delegation.eval.ts`         | `<delegation>` in `SYSTEM_INSTRUCTIONS`         | multi-step work → `delegate_task` with a concise `title`; simple asks → direct                               |
| `suites/profile-routing.eval.ts`    | `<delegation>` + the `profile` menu             | KB asks → `delegate_task` `profile: rag_research`; open-web asks → `web_research`; trivia → direct           |
| `suites/fork-tools.eval.ts`         | `FORK_INSTRUCTIONS` + `forkTools`               | a sub-agent uses `web_search` for research and doesn't force it when none fits                               |
| `suites/scratchpad.eval.ts`         | `<scratchpad>` in `SYSTEM_INSTRUCTIONS`         | multi-step tasks plan first (`update_scratchpad` before the work tools); single/trivial asks don't over-plan |
| `suites/ask-user-routing.eval.ts`   | clarification guidance in `SYSTEM_INSTRUCTIONS` | ambiguous asks seek the missing info (ask) instead of guessing                                               |
| `suites/context-discretion.eval.ts` | memory discretion rules                         | stored facts stay quiet unless the message calls for them                                                    |
| `suites/structured-output.eval.ts`  | `/structured` `ResponseSchema`                  | output validates as `{ answer, sources[] }`                                                                  |
| `suites/summarizer.eval.ts`         | `summarizer.ts`                                 | rolling summary stays short and keeps the facts                                                              |

## RAG eval (end-to-end, real services)

`suites/rag-eval.eval.ts` is unlike the others: it is a **true end-to-end test
with no mocks**. Each run resets its own isolated Qdrant collection + MinIO
bucket (`kb_eval-rag`), ingests the corpus in
[`rag-corpus/`](../apps/cli/evals/harness/rag-corpus/) through the app's production `store.sources`
pipeline, then runs the **actual `runAgentLoop`** (with the real
store-backed RAG tools) once per query. `retrievedContext` is captured from the
agent's genuine `search_knowledge_base` / `read_source` / `grep_files` tool
outputs, so the RAGAS-style scorers (from
[autoevals](https://github.com/braintrustdata/autoevals)) grade what the system
actually retrieved and generated. The harness lives alongside the other eval
machinery in [`harness/`](../apps/cli/evals/harness/) (`rag.ts`, `scorers/rag-scorers.ts`, `infra.ts`).

`suites/redundancy.eval.ts` reuses the same harness under the real `RAG_FORK_INSTRUCTIONS`
prompt: it runs the full loop over the real index and the `No redundant calls` scorer fails
if the run issues the same `(tool, args)` twice — the redundant re-reading the demo trace
showed. Redundancy is a whole-run property, so unlike the single-turn probe suites it needs
the real loop and services.

```bash
echo "OPENAI_API_KEY=sk-..." > .env
just eval-rag             # starts Qdrant, then ingests + runs the suite
```

Everything is automatic and fully programmatic — there are no CLIs to run. The
suite calls `harness.setup()` in its `data()` step, which prepares the services
(starts Qdrant + MinIO if they aren't up), wipes the suite's collection + bucket,
and ingests the corpus through the production `store.sources` pipeline. (evalite's
`setupFiles` also pre-warm the services via `harness/infra-setup.ts`, so the
prompt-only suites don't pay for it.) Ingestion is idempotent — re-running
re-indexes each file in place (no duplicates). Because generation goes through
the real agent, a case only
exercises retrieval when the model _chooses_ to call the search tool — a query
it answers from parametric knowledge (or refuses) shows empty
`retrievedContext`, which the scorers penalize. That is real system behaviour,
surfaced honestly rather than hidden.

RAGAS-style scorers: **Faithfulness** (answer grounded in retrieved context),
**Answer Relevancy**, **Context Relevancy**, **Context Precision** (needs a
ground-truth answer), plus a hand-rolled **Admits Insufficient** judge for
queries the corpus can't answer.

Hand-rolled retrieval/grounding scorers (set-overlap against a case's gold source
files): **Context Recall** (gold files the agent retrieved), **Retrieval
Precision** (of the files it retrieved, how many were gold — this is what
penalizes over-retrieval, the "gets all the things" problem the reranker
targets), **Retrieval F1** (harmonic mean of the two), **Citation Recall** (gold
files the agent cited), and **Citation Grounding** (every cited file was actually
retrieved — no fabricated citations). A `Hits` column also surfaces the raw
per-run hit count as an over-fetch-volume diagnostic. Together, Recall + Precision
let you prove a retrieval change made context **tighter without dropping what the
answer needs** — re-run with `RAG_RERANK_ENABLED=false` for a pure-RRF baseline.

## How it fits together

Evalite's model is `data → task → scorers`:

- **`data`** — the rows. Each is `{ input, expected }`. `input` is a
  [`ProbeSpec`](../apps/cli/evals/harness/probe.ts) (prompt + optional context/schema); `expected`
  is an [`Expected`](../apps/cli/evals/harness/scorers/common.ts) describing what a good answer does.
- **`task`** — [`probePrompt`](../apps/cli/evals/harness/probe.ts) runs _one_ model turn against
  the real system prompt + tools and returns the observable surface (`text`,
  `toolCalls`, `parsed`). It does **not** execute tools or run the loop, so it
  captures the model's _decision_ — exactly what routing evals score.
- **`scorers`** — one file each under [`harness/scorers/`](../apps/cli/evals/harness/scorers/),
  shared bits in [`common.ts`](../apps/cli/evals/harness/scorers/common.ts). The deterministic
  checks (`routing`, `toolArgument`, `conciseArg`, `avoidsTools`,
  `mentionsRequired`, `avoidsForbidden`, `matchesSchema`, `withinWordLimit`)
  inspect structured tool-call data or free text. The LLM judge (`judged`)
  grades open-ended criteria via our own shared
  `openai()` client (1–5, scaled to 0–1). Each reads the row's `expected` and
  returns 0–1.

### A scorer scores 1 when it doesn't apply

Evalite runs every scorer in an eval against every row. A scorer whose
`expected` field is absent for a row returns `{ score: 1, note: 'n/a' }` so one
scorer set can cover a mixed dataset. When a suite mixes applicable and n/a
rows, read the **per-row** score in the UI, not just the eval average.

## Adding a case

Append a row to the relevant eval's `data`:

```ts
{
  input: { prompt: 'What time zone is Tokyo in?' },
  expected: { route: 'direct' },   // must answer without a tool
}
```

Add a whole new suite by creating `apps/cli/evals/suites/<name>.eval.ts` — evalite discovers
any `*.eval.ts` file automatically.

## A note on non-determinism

These call a real model, so a single failure isn't proof of a broken prompt —
re-run, and treat a row that flips as a signal the prompt is _ambiguous_ on that
input. Probes use `temperature: 0` to keep runs as stable as possible; set
`trialCount` on an eval to run each row several times.
