import type { OpenAI } from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { Agent, TurnContext } from "../agent";
import type { EventBus } from "../agent/events/bus";
import type { ApprovalDecision, ApprovalGate, ApprovalRequest } from "../agent/humanLayer/approval";
import type {
  ClarificationGate,
  ClarificationRequest,
  ClarificationResponse,
} from "../agent/humanLayer/clarification";
import type { TurnOptions } from "../agent/conversation";
import type { AgentEvent } from "../runner/thread/events";
import { countUserTurns } from "../runner/thread/window";
import type { Span } from "@opentelemetry/api";
import { summarize } from "../tokens";
import {
  endSpan,
  recordLlmSpan,
  recordTurnTimeToFirstToken,
  setSpanIO,
  startSpan,
  withSpan,
} from "../telemetry";
import {
  type ConversationItemInsert,
  type IndexResult,
  type ItemKind,
  type SourceProgress,
  type Store,
  responseUsageToTokens,
} from "../store";
import { CHEAP_MODEL, MAX_CONSECUTIVE_ERRORS, MAX_TOOL_STEPS, ORCHESTRATOR_MODEL } from "../config";
import { createSerialQueue } from "../utils/serial-queue";
import { runAgentLoop } from "../runner/runner";
import { formatReport, usageSnapshot, type UsageSnapshot } from "./usage";

function eventKind(event: AgentEvent): ItemKind {
  return event.type;
}

function titleFromFirstPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 20) || "New chat";
}

export class Session {
  private currentTurnIndex = 0;
  private alwaysAllowed = new Set<string>();
  private handler: ApprovalGate | undefined;
  private clarificationHandler: ClarificationGate | undefined;
  private readonly humanPrompts = createSerialQueue();

  private constructor(
    private readonly agent: Agent,
    private readonly openai: OpenAI,
    private activeStore: Store,
    private readonly keepLastTurns: number,
    private readonly bus: EventBus,
  ) {}

  get store(): Store {
    return this.activeStore;
  }

  static async create(
    agent: Agent,
    openai: OpenAI,
    store: Store,
    keepLastTurns: number,
    bus: EventBus,
  ): Promise<Session> {
    return new Session(agent, openai, store, keepLastTurns, bus);
  }

  rebind(store: Store): void {
    this.activeStore = store;
    this.reset();
  }

  reset(): void {
    this.currentTurnIndex = 0;
    this.alwaysAllowed.clear();
  }

  setApprovalHandler(handler: ApprovalGate): void {
    this.handler = handler;
  }

  get hasApprovalHandler(): boolean {
    return this.handler !== undefined;
  }

  setClarificationHandler(handler: ClarificationGate): void {
    this.clarificationHandler = handler;
  }

  get hasClarificationHandler(): boolean {
    return this.clarificationHandler !== undefined;
  }

  private approvalGate: ApprovalGate = (request) =>
    this.humanPrompts.enqueue(() => this.decide(request));

  private clarificationGate: ClarificationGate = (request) =>
    this.humanPrompts.enqueue(() => this.clarify(request));

  private async decide(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (this.alwaysAllowed.has(request.toolName)) return { outcome: "approve" };
    const handler = this.handler;
    if (!handler) return { outcome: "approve" };
    const decision = await handler(request);
    if (decision.outcome === "always" && request.allowAlways !== false) {
      this.alwaysAllowed.add(request.toolName);
    }
    return decision;
  }

  private async clarify(request: ClarificationRequest): Promise<ClarificationResponse> {
    const handler = this.clarificationHandler;
    if (!handler) return { answer: null };
    return handler(request);
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
  history(): Promise<AgentEvent[]> {
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

  async runTurn(prompt: string, options: TurnOptions): Promise<string> {
    const { conversation, conversationId } = this.store;
    const tail = await conversation.queryHistory(conversationId).afterLastSummary().execute();
    this.currentTurnIndex = countUserTurns(tail);

    const userMessage: AgentEvent = { type: "user_message", content: prompt };

    let title: string | undefined;
    if (this.currentTurnIndex === 0) {
      const row = await conversation.query().byId(conversationId).executeAndTakeFirst();
      if (row?.title === "New chat") title = titleFromFirstPrompt(prompt);
    }

    await conversation.appendUserMessage(
      conversationId,
      {
        kind: "user_message",
        turnIndex: this.currentTurnIndex,
        payload: userMessage,
      },
      title,
    );

    const events = await conversation.queryHistory(conversationId).forModel().execute();
    const turnSettings = await this.effectiveTurnSettings();
    const context: TurnContext = {
      memories: await this.memories(),
      ...(this.handler ? { requestApproval: this.approvalGate } : {}),
      ...(this.clarificationHandler ? { requestClarification: this.clarificationGate } : {}),
    };
    const turnOptions = { ...options, ...turnSettings };

    return withSpan(
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
      (turnSpan) => this.driveTurn(turnSpan, events, turnOptions, context, turnSettings.model),
    );
  }

  /** Run one turn through the loop, persist the produced transcript, and return the answer. */
  private async driveTurn(
    turnSpan: Span,
    events: readonly AgentEvent[],
    turnOptions: TurnOptions,
    context: TurnContext,
    model: string,
  ): Promise<string> {
    const turnStart = performance.now();
    let firstToken = true;
    const unsubscribe = this.bus.subscribe((event) => {
      if (event.type === "delta" && firstToken) {
        firstToken = false;
        recordTurnTimeToFirstToken(turnSpan, (performance.now() - turnStart) / 1000, model);
      }
    });

    try {
      const {
        answer,
        events: produced,
        usage,
      } = await runAgentLoop({
        agent: this.agent,
        events,
        options: turnOptions,
        context,
        bus: this.bus,
        maxToolSteps: MAX_TOOL_STEPS,
        maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
      });
      await this.persistTurn(produced, usage);
      setSpanIO(turnSpan, { output: answer });
      await this.maintainWindow(turnSpan);
      return answer;
    } finally {
      unsubscribe();
    }
  }

  private async persistTurn(events: AgentEvent[], usage: ResponseUsage | undefined): Promise<void> {
    if (!events.length) return;
    const tokens = responseUsageToTokens(usage ?? {});
    const inserts: ConversationItemInsert[] = events.map((event, index) => ({
      kind: eventKind(event),
      turnIndex: this.currentTurnIndex,
      payload: event,
      tokens: index === events.length - 1 ? tokens : undefined,
    }));
    await this.store.conversation.createItems(this.store.conversationId, inserts);
  }

  // Once the un-summarized tail overflows keepLastTurns, fold the WHOLE tail into a
  // new summary *segment* and append it. forModel() returns every segment plus the
  // messages after the last one, so nothing is silently dropped as the window slides.
  private async maintainWindow(parent?: Span): Promise<void> {
    const { conversation, conversationId } = this.store;
    const evicted = await conversation.queryHistory(conversationId).afterLastSummary().execute();
    if (countUserTurns(evicted) <= this.keepLastTurns) return;

    const span = startSpan("conversation.summarize", {
      parent,
      attributes: {
        "conversation.id": conversationId,
        "chat.evicted_turns": countUserTurns(evicted),
      },
    });
    try {
      const { text, usage } = await summarize(this.openai, "", evicted);
      recordLlmSpan(span, {
        model: CHEAP_MODEL,
        operation: "summarize",
        usage,
        input: JSON.stringify({ evicted }),
        output: text,
      });
      await conversation.createItems(conversationId, {
        kind: "summary",
        turnIndex: null,
        payload: { type: "summary", content: text },
        tokens: { summarizerTokens: usage?.total_tokens ?? 0 },
      });
      endSpan(span);
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  }
}
