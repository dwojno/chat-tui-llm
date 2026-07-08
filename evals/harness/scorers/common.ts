import { createScorer } from "evalite";
import type { z } from "zod";
import type { ProbeResult } from "../probe";

/**
 * Per-row expectation. Every field is optional; a scorer whose field is absent
 * for a row scores 1 with `{ note: 'n/a' }` so a single scorer set can cover a
 * mixed dataset. Read the per-row score in the UI rather than the eval average
 * when a suite mixes applicable and n/a rows.
 */
export interface Expected {
  /** A tool that must be called, or 'direct' for a no-tool answer. */
  route?: "direct" | (string & {});
  /** A called tool's argument that must contain a substring. */
  toolArg?: { key: string; contains: string };
  /** A called tool's arg must be present and within a word budget (e.g. a concise title). */
  conciseArg?: { key: string; maxWords: number };
  /** Tools that must NOT be called this turn. */
  forbidTools?: string[];
  /** Substrings the answer must include (case-insensitive). */
  mustContain?: string[];
  /** Substrings the answer must NOT include — used to catch leaked facts. */
  mustOmit?: string[];
  /** Schema the structured output must validate against. */
  schema?: z.ZodType;
  /** Maximum word count. */
  maxWords?: number;
  /** Rubric for the LLM-as-judge scorer. */
  judge?: string;
}

/** True when a row didn't set this expectation — the scorer should no-op. */
export const isAbsent = <T>(value: T | undefined): value is undefined => value === undefined;

/** Score returned when a scorer doesn't apply to a row. */
export const notApplicable = { score: 1, metadata: { note: "n/a" } };

export const lowercase = (text: string) => text.toLowerCase();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Case-insensitive match anchored at a word boundary: `'rust'` hits `"Rust"`
 * and `"Rusty"` but not `"trust"`/`"crust"`, while `'peanut'` still hits
 * `"peanuts"`. Prevents forbidden-substring checks from firing on innocent
 * words that happen to contain the term.
 */
export const containsTerm = (haystack: string, term: string) =>
  new RegExp(`\\b${escapeRegExp(term)}`, "i").test(haystack);

export type Scorer = ReturnType<typeof createScorer<unknown, ProbeResult, Expected>>;

/** Build a scorer over the shared `ProbeResult`/`Expected` types. */
export const defineScorer = (
  name: string,
  description: string,
  scorer: Parameters<typeof createScorer<unknown, ProbeResult, Expected>>[0]["scorer"],
): Scorer => createScorer<unknown, ProbeResult, Expected>({ name, description, scorer });
