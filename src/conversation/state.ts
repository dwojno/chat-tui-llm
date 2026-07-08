import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { ConversationScope } from "./scope";

/**
 * Rough token estimate for accounting only (chars / 4). We use it for the
 * naive-append baseline, where we have text but never actually send it to the
 * API, so there is no real `usage` to read. Actual sent/cached tokens always
 * come from the API's `usage` — never from this heuristic.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface UsageTotals {
  /** Input tokens the API actually billed us for (windowed + summary prefix). */
  actualInput: number;
  /** Of `actualInput`, how many were served from the prompt cache. */
  cachedInput: number;
  /** Output tokens generated for assistant replies. */
  output: number;
  /** Extra tokens spent on summarizer calls — the cost of the strategy. */
  summarizer: number;
  /**
   * What a naive append-everything bot would have sent as input across all
   * turns: the full transcript re-sent every turn. Estimated, never billed.
   */
  baselineInput: number;
  /** Completed user turns. */
  turns: number;
}

interface PersistedState {
  summary: string;
  facts: string[];
  sources: string[];
  usage: UsageTotals;
}

const EMPTY_USAGE: UsageTotals = {
  actualInput: 0,
  cachedInput: 0,
  output: 0,
  summarizer: 0,
  baselineInput: 0,
  turns: 0,
};

/**
 * Durable, out-of-context-window state. The rolling summary and pinned facts
 * live here (and on disk) rather than in the transcript we send to the model;
 * only a distilled prefix is injected per request. Also accumulates the token
 * accounting used for the savings report.
 */
export class SessionState implements ConversationScope {
  private summaryText = "";
  private factList: string[] = [];
  private sourceList: string[] = [];
  private usage: UsageTotals = { ...EMPTY_USAGE };

  /**
   * Running estimate of the *full* transcript size (never truncated). Models
   * what a naive bot would carry; feeds the per-turn baseline snapshot.
   */
  private naiveTokens = 0;

  private constructor(private readonly filePath: string) {}

  /** Load persisted state from disk, or start fresh if none exists. */
  static load(filePath: string): SessionState {
    const state = new SessionState(filePath);
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf8")) as PersistedState;
        state.summaryText = data.summary ?? "";
        state.factList = data.facts ?? [];
        state.sourceList = data.sources ?? [];
        state.usage = { ...EMPTY_USAGE, ...data.usage };
      } catch {
        // Corrupt state file — ignore and start clean rather than crash.
      }
    }
    return state;
  }

  get summary(): string {
    return this.summaryText;
  }

  get facts(): readonly string[] {
    return this.factList;
  }

  /** cwd-relative source files indexed for RAG (via `/learn`). */
  get sources(): readonly string[] {
    return this.sourceList;
  }

  /** Stable per-conversation key so repeated prefixes route to the same cache. */
  get cacheKey(): string {
    return `chat-cli:${process.pid}`;
  }

  setSummary(summary: string): void {
    this.summaryText = summary;
    this.save();
  }

  addFact(fact: string): void {
    this.factList.push(fact);
    this.save();
  }

  /** Add unique source paths; returns only the paths that were newly added. */
  addSources(paths: readonly string[]): string[] {
    const added: string[] = [];
    const known = new Set(this.sourceList);
    for (const path of paths) {
      if (known.has(path)) continue;
      known.add(path);
      this.sourceList.push(path);
      added.push(path);
    }
    if (added.length) this.save();
    return added;
  }

  /** Grow the naive-transcript estimate as items are appended to history. */
  growNaive(text: string): void {
    this.naiveTokens += estimateTokens(text);
  }

  /** A snapshot of what a naive bot would send as input right now. */
  snapshotNaiveInput(instructionsTokens: number): number {
    return this.naiveTokens + instructionsTokens;
  }

  /** Fold one API response's real usage into the totals. */
  addResponseUsage(usage: ResponseUsage | undefined): void {
    if (!usage) return;
    this.usage.actualInput += usage.input_tokens;
    this.usage.cachedInput += usage.input_tokens_details?.cached_tokens ?? 0;
    this.usage.output += usage.output_tokens;
  }

  /** Account for the overhead of a summarizer call (input + output). */
  addSummarizerUsage(usage: ResponseUsage | undefined): void {
    if (!usage) return;
    this.usage.summarizer += usage.total_tokens;
  }

  /** Close out a turn: record its naive baseline and persist. */
  finishTurn(naiveInputThisTurn: number): void {
    this.usage.baselineInput += naiveInputThisTurn;
    this.usage.turns += 1;
    this.save();
  }

  private save(): void {
    const data: PersistedState = {
      summary: this.summaryText,
      facts: this.factList,
      sources: this.sourceList,
      usage: this.usage,
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  /** Human-readable token-savings accounting. */
  report(): string {
    const u = this.usage;
    if (u.turns === 0) return "No turns recorded — nothing to report.";

    const n = (value: number): string => value.toLocaleString("en-US");
    const pct = (part: number, whole: number): string =>
      whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

    // Net input tokens paid vs. what naive append-everything would have cost,
    // charging the summarizer overhead against our strategy.
    const netInput = u.actualInput + u.summarizer;
    const saved = u.baselineInput - netInput;

    return [
      `Context report — ${u.turns} turn${u.turns === 1 ? "" : "s"}`,
      `  Input sent (actual):     ${n(u.actualInput)} tok`,
      `    └ served from cache:   ${n(u.cachedInput)} tok (${pct(u.cachedInput, u.actualInput)})`,
      `  Summarizer overhead:     ${n(u.summarizer)} tok`,
      `  Naive append-all input:  ${n(u.baselineInput)} tok`,
      `  Saved vs naive:          ${n(saved)} tok (${pct(saved, u.baselineInput)})`,
      `  Output generated:        ${n(u.output)} tok`,
    ].join("\n");
  }
}
