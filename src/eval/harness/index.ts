/**
 * The eval harness: the reusable machinery the suites build on. Suites import
 * from here (`../harness`) rather than reaching into individual files.
 *
 * - `probePrompt` — run one model turn against a real prompt/tools (the `task`).
 * - scorers — score a {@link ProbeResult} against a row's `Expected`.
 * - `openai` — the shared lazy client.
 */
export { openai } from './client'
export { probePrompt, type ProbeResult, type ProbeSpec } from './probe'
export {
  avoidsForbidden,
  judged,
  matchesSchema,
  mentionsRequired,
  routing,
  toolArgument,
  withinWordLimit,
  type Expected,
} from './scorers'
