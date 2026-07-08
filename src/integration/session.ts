import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { AgentService, TurnContext } from "../agent";
import type { TurnOptions } from "../agent/conversation";
import { countUserTurns, splitAtLastTurns } from "../agent/conversation";
import type { TurnEvent } from "../agent/events";
import { summarize } from "../agent/tokens";
import type { Store } from "../store/store";
import { responseUsageToTokens } from "../store/derive";
import type { ConversationItemInsert, ItemKind, TokenColumns } from "../store/types";
import { formatReport, usageSnapshot, type UsageSnapshot } from "./usage";

function itemKind(item: ResponseInputItem): ItemKind {
  if ("role" in item) return "message";
  if (item.type === "function_call") return "function_call";
  return "function_call_output";
}

export class Session {
  private pendingUsage: TokenColumns | null = null;
  private pendingMessages: ResponseInputItem[] = [];
  private currentTurnIndex = 0;

  private constructor(
    private readonly agent: AgentService,
    private readonly openai: OpenAI,
    private readonly store: Store,
    private readonly keepLastTurns: number,
  ) {}

  static async create(
    agent: AgentService,
    openai: OpenAI,
    store: Store,
    keepLastTurns: number,
  ): Promise<Session> {
    return new Session(agent, openai, store, keepLastTurns);
  }

  async facts(): Promise<string[]> {
    return this.store.fact.list();
  }

  async sources(): Promise<string[]> {
    return this.store.sources.list();
  }

  async getUsageTotals(): Promise<UsageSnapshot> {
    const totals = await this.store.conversation.getUsageTotals();
    return usageSnapshot(totals);
  }

  /** Full persisted transcript (all turns, not just the in-context window) for UI replay. */
  history(): Promise<ResponseInputItem[]> {
    return this.store.conversation.queryHistory().execute();
  }

  async report(): Promise<string> {
    return formatReport(await this.store.conversation.getUsageTotals());
  }

  async addFact(fact: string): Promise<void> {
    await this.store.fact.add(fact);
  }

  async addSources(paths: readonly string[]): Promise<string[]> {
    return this.store.sources.add(paths);
  }

  async *runTurn(prompt: string, options: TurnOptions): AsyncGenerator<TurnEvent, void> {
    const { conversation } = this.store;
    const tail = await conversation.queryHistory().afterLastSummary().execute();
    this.currentTurnIndex = countUserTurns(tail);

    const userMessage = {
      role: "user",
      content: prompt,
    } satisfies ResponseInputItem;

    await conversation.appendItem({
      kind: "message",
      turnIndex: this.currentTurnIndex,
      payload: userMessage,
    });

    const messages = await conversation.queryHistory().forModel().execute();
    const context: TurnContext = {
      facts: await this.facts(),
    };

    for await (const event of this.agent.run(messages, options, context)) {
      switch (event.type) {
        case "message":
          this.pendingMessages.push(event.item);
          break;
        case "usage":
          if (event.kind === "response") {
            await this.flushPendingMessages();
            this.pendingUsage = responseUsageToTokens(event.usage ?? {});
          } else {
            await this.flushPendingMessages();
          }
          break;
        default:
          yield event;
      }
    }

    await this.flushPendingMessages();
    await this.maintainWindow();
  }

  private async flushPendingMessages(): Promise<void> {
    if (!this.pendingMessages.length) return;

    const messages = this.pendingMessages;
    this.pendingMessages = [];
    const usage = this.pendingUsage;
    this.pendingUsage = null;

    const inserts: ConversationItemInsert[] = messages.map((item, index) => ({
      kind: itemKind(item),
      turnIndex: this.currentTurnIndex,
      payload: item,
      tokens: index === messages.length - 1 ? (usage ?? undefined) : undefined,
    }));
    await this.store.conversation.appendItems(inserts);
  }

  private async maintainWindow(): Promise<void> {
    const { conversation } = this.store;
    const tail = await conversation.queryHistory().afterLastSummary().execute();
    if (countUserTurns(tail) <= this.keepLastTurns) return;

    const { evicted } = splitAtLastTurns(tail, this.keepLastTurns);
    if (!evicted.length) return;

    const priorSummary = await conversation.readLatestSummaryText();
    const { text, usage } = await summarize(this.openai, priorSummary, evicted);
    await conversation.appendItem({
      kind: "summary",
      turnIndex: null,
      payload: { content: text },
      tokens: { summarizerTokens: usage?.total_tokens ?? 0 },
    });
  }
}
