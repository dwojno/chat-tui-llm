import type { OpenAI } from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import type { AgentService, TurnContext } from "../agent";
import type { TurnOptions } from "../agent/conversation";
import { countUserTurns, splitAtLastTurns } from "../agent/conversation";
import type { TurnEvent } from "../agent/events";
import type { Span } from "@opentelemetry/api";
import { summarize } from "../agent/tokens";
import {
  endSpan,
  recordLlmSpan,
  recordTurnTimeToFirstToken,
  setSpanIO,
  startSpan,
  withSpan,
} from "../agent/telemetry";
import {
  type ConversationItemInsert,
  type IndexResult,
  type ItemKind,
  type SourceProgress,
  type Store,
  type TokenColumns,
  responseUsageToTokens,
} from "../store";
import { CHEAP_MODEL, ORCHESTRATOR_MODEL } from "../agent/config";
import { formatReport, usageSnapshot, type UsageSnapshot } from "./usage";

function itemKind(item: ResponseInputItem): ItemKind {
  if ("role" in item) return "message";
  if (item.type === "function_call") return "function_call";
  return "function_call_output";
}

function titleFromFirstPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 20) || "New chat";
}

export class Session {
  private pendingUsage: TokenColumns | null = null;
  private pendingMessages: ResponseInputItem[] = [];
  private currentTurnIndex = 0;

  private constructor(
    private readonly agent: AgentService,
    private readonly openai: OpenAI,
    private activeStore: Store,
    private readonly keepLastTurns: number,
  ) {}

  get store(): Store {
    return this.activeStore;
  }

  static async create(
    agent: AgentService,
    openai: OpenAI,
    store: Store,
    keepLastTurns: number,
  ): Promise<Session> {
    return new Session(agent, openai, store, keepLastTurns);
  }

  rebind(store: Store): void {
    this.activeStore = store;
    this.reset();
  }

  reset(): void {
    this.pendingMessages = [];
    this.pendingUsage = null;
    this.currentTurnIndex = 0;
  }

  private async effectiveTurnSettings(): Promise<{ model: string }> {
    const userProfile = await this.store.profile
      .query()
      .byId(this.store.profileId)
      .executeAndTakeFirst();
    return {
      model: userProfile?.model ?? ORCHESTRATOR_MODEL,
    };
  }

  async memories(): Promise<string[]> {
    const rows = await this.store.memory.query().forProfile(this.store.profileId).execute();
    return rows.map((row) => row.text);
  }

  async sources(): Promise<string[]> {
    const rows = await this.store.sources.query().forProfile(this.store.profileId).execute();
    return rows.map((row) => row.path);
  }

  async getUsageTotals(): Promise<UsageSnapshot> {
    const totals = await this.store.conversation.usageTotals(this.store.conversationId);
    return usageSnapshot(totals);
  }

  /** Full persisted transcript (all turns, not just the in-context window) for UI replay. */
  history(): Promise<ResponseInputItem[]> {
    return this.store.conversation.queryHistory(this.store.conversationId).execute();
  }

  async report(): Promise<string> {
    return formatReport(await this.store.conversation.usageTotals(this.store.conversationId));
  }

  async addMemory(memory: string): Promise<void> {
    await this.store.memory.create(this.store.profileId, memory);
  }

  /** Add + index a single source file, streaming progress steps then the result. */
  indexSource(path: string): AsyncGenerator<SourceProgress, IndexResult> {
    return this.store.sources.add(this.store.profileId, path);
  }

  /** Re-index every source in the current profile, streaming progress. */
  reindexSources(): AsyncGenerator<SourceProgress, IndexResult[]> {
    return this.store.sources.reindex(this.store.profileId);
  }

  async *runTurn(prompt: string, options: TurnOptions): AsyncGenerator<TurnEvent, void> {
    const { conversation, conversationId } = this.store;
    const tail = await conversation.queryHistory(conversationId).afterLastSummary().execute();
    this.currentTurnIndex = countUserTurns(tail);

    const userMessage = {
      role: "user",
      content: prompt,
    } satisfies ResponseInputItem;

    let title: string | undefined;
    if (this.currentTurnIndex === 0) {
      const row = await conversation.query().byId(conversationId).executeAndTakeFirst();
      if (row?.title === "New chat") title = titleFromFirstPrompt(prompt);
    }

    await conversation.appendUserMessage(
      conversationId,
      {
        kind: "message",
        turnIndex: this.currentTurnIndex,
        payload: userMessage,
      },
      title,
    );

    const messages = await conversation.queryHistory(conversationId).forModel().execute();
    const turnSettings = await this.effectiveTurnSettings();
    const context: TurnContext = {
      memories: await this.memories(),
    };
    const turnOptions = { ...options, ...turnSettings };

    yield* withSpan(
      "chat.turn",
      {
        attributes: {
          "conversation.id": conversationId,
          "profile.id": this.store.profileId,
          // Non-gen_ai key on purpose: a `model` attribute would make Langfuse
          // classify this root span as a generation instead of the trace root.
          "chat.model": turnSettings.model,
          "chat.turn.index": this.currentTurnIndex,
        },
        input: prompt,
      },
      (turnSpan) => this.driveAgent(turnSpan, messages, turnOptions, context, turnSettings.model),
    );
  }

  /** Drive the agent loop for one turn: persist items, feed usage, surface UI events. */
  private async *driveAgent(
    turnSpan: Span,
    messages: readonly ResponseInputItem[],
    turnOptions: TurnOptions,
    context: TurnContext,
    model: string,
  ): AsyncGenerator<TurnEvent, void> {
    const turnStart = performance.now();
    let firstToken = true;
    for await (const event of this.agent.run(messages, turnOptions, context)) {
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
          // First text token reaching the user — the turn-level TTFT that spans
          // any tool rounds before the answer streamed, unlike per-call TTFT.
          if (event.type === "delta" && firstToken) {
            recordTurnTimeToFirstToken(turnSpan, (performance.now() - turnStart) / 1000, model);
            firstToken = false;
          }
          if (event.type === "answer") setSpanIO(turnSpan, { output: event.content });
          yield event;
      }
    }

    await this.flushPendingMessages();
    await this.maintainWindow(turnSpan);
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
    await this.store.conversation.createItems(this.store.conversationId, inserts);
  }

  private async maintainWindow(parent?: Span): Promise<void> {
    const { conversation, conversationId } = this.store;
    const tail = await conversation.queryHistory(conversationId).afterLastSummary().execute();
    if (countUserTurns(tail) <= this.keepLastTurns) return;

    const { evicted } = splitAtLastTurns(tail, this.keepLastTurns);
    if (!evicted.length) return;

    const priorSummary = await conversation.readLatestSummaryText(conversationId);
    const span = startSpan("conversation.summarize", {
      parent,
      attributes: {
        "conversation.id": conversationId,
        "chat.evicted_turns": countUserTurns(evicted),
      },
    });
    try {
      const { text, usage } = await summarize(this.openai, priorSummary, evicted);
      recordLlmSpan(span, {
        model: CHEAP_MODEL,
        operation: "summarize",
        usage,
        input: JSON.stringify({ priorSummary, evicted }),
        output: text,
      });
      await conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { content: text },
        tokens: { summarizerTokens: usage?.total_tokens ?? 0 },
      });
      endSpan(span);
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  }
}
