import { randomUUID } from "node:crypto";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";

/**
 * Narrow state surface used by {@link ConversationService}. Main sessions use
 * {@link SessionState}; forked child sessions use {@link EphemeralScope}.
 */
export interface ConversationScope {
  readonly summary: string;
  readonly facts: readonly string[];
  readonly cacheKey: string;
  setSummary(summary: string): void;
  addResponseUsage(usage: ResponseUsage | undefined): void;
  addSummarizerUsage(usage: ResponseUsage | undefined): void;
  growNaive?(text: string): void;
  finishTurn?(naiveInput: number): void;
  snapshotNaiveInput?(instructionsTokens: number): number;
}

/**
 * In-memory scope for forked sub-agents. Windowing summary stays local; usage
 * rolls up to the parent so the session token report stays accurate.
 */
export class EphemeralScope implements ConversationScope {
  private summaryText = "";
  private readonly forkId = randomUUID();

  constructor(private readonly parent: ConversationScope) {}

  get summary(): string {
    return this.summaryText;
  }

  get facts(): readonly string[] {
    return this.parent.facts;
  }

  get cacheKey(): string {
    return `chat-cli:fork:${this.forkId}`;
  }

  setSummary(summary: string): void {
    this.summaryText = summary;
  }

  addResponseUsage(usage: ResponseUsage | undefined): void {
    this.parent.addResponseUsage(usage);
  }

  addSummarizerUsage(usage: ResponseUsage | undefined): void {
    this.parent.addSummarizerUsage(usage);
  }
}
