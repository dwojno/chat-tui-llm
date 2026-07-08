import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { AgentService, TurnContext } from "../agent";
import type { TurnOptions } from "../agent/conversation";
import { countUserTurns, renderItemsText, splitAtLastTurns } from "../agent/conversation";
import type { TurnEvent } from "../agent/events";
import { SYSTEM_INSTRUCTIONS } from "../agent/prompts";
import { estimateTokens, summarize } from "../agent/tokens";
import type { ConversationStore } from "./store/types";
import {
  addResponseUsage,
  addSummarizerUsage,
  EMPTY_USAGE,
  formatReport,
  usageSnapshot,
  type UsageSnapshot,
  type UsageTotals,
} from "./usage";

export class Session {
  private log: ResponseInputItem[] = [];
  private summaryText: string;
  private factList: string[];
  private sourceList: string[];
  private usage: UsageTotals;
  private naiveTokens = 0;

  constructor(
    private readonly agent: AgentService,
    private readonly openai: OpenAI,
    private readonly store: ConversationStore,
    private readonly keepLastTurns: number,
  ) {
    const loaded = store.load();
    this.summaryText = loaded?.summary ?? "";
    this.factList = loaded?.facts ?? [];
    this.sourceList = loaded?.sources ?? [];
    this.usage = { ...EMPTY_USAGE, ...loaded?.usage };
  }

  get summary(): string {
    return this.summaryText;
  }

  get facts(): readonly string[] {
    return this.factList;
  }

  get sources(): readonly string[] {
    return this.sourceList;
  }

  get usageTotals(): UsageSnapshot {
    return usageSnapshot(this.usage);
  }

  get transcript(): readonly ResponseInputItem[] {
    return this.log;
  }

  report(): string {
    return formatReport(this.usage);
  }

  addFact(fact: string): void {
    this.factList.push(fact);
    this.persist();
  }

  addSources(paths: readonly string[]): string[] {
    const added: string[] = [];
    const known = new Set(this.sourceList);
    for (const path of paths) {
      if (known.has(path)) continue;
      known.add(path);
      this.sourceList.push(path);
      added.push(path);
    }
    if (added.length) this.persist();
    return added;
  }

  async *runTurn(prompt: string, options: TurnOptions): AsyncGenerator<TurnEvent, void> {
    const userMessage = {
      role: "user",
      content: prompt,
    } satisfies ResponseInputItem;
    this.log.push(userMessage);
    this.growNaive(`user: ${prompt}`);

    const context: TurnContext = {
      facts: this.factList,
      summary: this.summaryText,
    };

    for await (const event of this.agent.run(this.log, options, context)) {
      switch (event.type) {
        case "message":
          this.log.push(event.item);
          this.growNaive(renderItemsText([event.item]));
          break;
        case "usage":
          if (event.kind === "response") addResponseUsage(this.usage, event.usage);
          else addSummarizerUsage(this.usage, event.usage);
          break;
        default:
          yield event;
      }
    }

    this.finishTurn();
    await this.maintainWindow();
    this.persist();
  }

  private growNaive(text: string): void {
    this.naiveTokens += estimateTokens(text);
  }

  private finishTurn(): void {
    this.usage.baselineInput += this.naiveTokens + estimateTokens(SYSTEM_INSTRUCTIONS);
    this.usage.turns += 1;
  }

  private async maintainWindow(): Promise<void> {
    if (countUserTurns(this.log) <= this.keepLastTurns) return;

    const { evicted, kept } = splitAtLastTurns(this.log, this.keepLastTurns);
    if (!evicted.length) return;

    const { text, usage } = await summarize(this.openai, this.summaryText, evicted);
    addSummarizerUsage(this.usage, usage);
    this.summaryText = text;
    this.log = kept;
  }

  private persist(): void {
    this.store.save({
      summary: this.summaryText,
      facts: this.factList,
      sources: this.sourceList,
      usage: this.usage,
    });
  }
}
