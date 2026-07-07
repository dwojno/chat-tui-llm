# Prompt evals

A frameworkless agent lives and dies by its prompts, so those get tested like
code. These are behavioural tests for the **prompts and tools** this app ships —
not the TypeScript, the prompts: does the model route to the right tool, stay
quiet about stored facts until asked, keep summaries short? Built on
[evalite](https://evalite.dev). Each eval drives a real prompt from the codebase
against the live model and scores what comes back.

```bash
pnpm eval          # run once (evalite run)
pnpm eval:watch    # watch + UI at http://localhost:3006
```

Requires a real `OPENAI_API_KEY` — loaded from `.env` via `setupFiles` in
[evalite.config.ts](../../evalite.config.ts).

## What's covered

The tests live in [`suites/`](suites/); the reusable machinery lives in
[`harness/`](harness/); the runner config is [`evalite.config.ts`](../../evalite.config.ts)
at the repo root.

```
src/eval/
  harness/        the machinery (imported via `../harness`)
    probe.ts      the task: one model turn → observable result
    scorers/      scorers that grade a result against `Expected`
    client.ts     shared lazy OpenAI client
    index.ts      barrel — suites import from here
  suites/         the tests, one *.eval.ts per prompt
```

| Suite | Prompt under test | Scores |
| --- | --- | --- |
| `suites/delegation.eval.ts` | `<delegation>` in `SYSTEM_INSTRUCTIONS` | multi-step work → `delegate_task`; simple asks → direct |
| `suites/weather-routing.eval.ts` | `<tool_use>` | single-city asks call `get_weather_data` with the right city |
| `suites/context-discretion.eval.ts` | `buildContextBlock` rules | stored facts stay quiet unless the message calls for them |
| `suites/structured-output.eval.ts` | `/structured` `ResponseSchema` | output validates as `{ answer, sources[] }` |
| `suites/summarizer.eval.ts` | `summarizer.ts` | rolling summary stays short and keeps the facts |

## How it fits together

Evalite's model is `data → task → scorers`:

- **`data`** — the rows. Each is `{ input, expected }`. `input` is a
  [`ProbeSpec`](harness/probe.ts) (prompt + optional context/schema); `expected`
  is an [`Expected`](harness/scorers.ts) describing what a good answer does.
- **`task`** — [`probePrompt`](harness/probe.ts) runs *one* model turn against
  the real system prompt + tools and returns the observable surface (`text`,
  `toolCalls`, `parsed`). It does **not** execute tools or run the loop, so it
  captures the model's *decision* — exactly what routing evals score.
- **`scorers`** — one file each under [`harness/scorers/`](harness/scorers/),
  shared bits in [`common.ts`](harness/scorers/common.ts). The deterministic
  checks (`routing`, `toolArgument`, `mentionsRequired`, `avoidsForbidden`,
  `matchesSchema`, `withinWordLimit`) inspect structured tool-call data or free
  text. The LLM judge (`judged`) grades open-ended criteria via our own shared
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

Add a whole new suite by creating `src/eval/suites/<name>.eval.ts` — evalite discovers
any `*.eval.ts` file automatically.

## A note on non-determinism

These call a real model, so a single failure isn't proof of a broken prompt —
re-run, and treat a row that flips as a signal the prompt is *ambiguous* on that
input. Probes use `temperature: 0` to keep runs as stable as possible; set
`trialCount` on an eval to run each row several times.
