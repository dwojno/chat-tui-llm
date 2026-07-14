import type { AgentEvent } from "../../runner/thread/events";
import type { UsageTotals } from "../../integration/usage";
import type { StoreContext } from "../context";
import { asArray, type OneOrMany } from "../helpers";
import {
  ConversationRepository,
  type Conversation,
  type ConversationItemInsert,
  type ConversationQuery,
  type HistoryQueryConfig,
} from "./conversation.repository";

export class HistoryQuery {
  private readonly config: HistoryQueryConfig = {
    afterLastSummary: false,
  };

  constructor(
    private readonly repo: ConversationRepository,
    private readonly conversationId: string,
  ) {}

  forConversation(conversationId: string): this {
    this.config.conversationId = conversationId;
    return this;
  }

  forSession(sessionId: string): this {
    return this.forConversation(sessionId);
  }

  afterLastSummary(): this {
    this.config.afterLastSummary = true;
    return this;
  }

  /** The model window: every summary segment, then the messages after the last one. */
  forModel(): this {
    this.config.forModel = true;
    return this;
  }

  execute(): Promise<AgentEvent[]> {
    return this.repo.runHistoryQuery(this.conversationId, this.config);
  }
}

export abstract class ConversationFacade {
  abstract query(): ConversationQuery;
  abstract queryHistory(conversationId: string): HistoryQuery;
  abstract create(profileId: string, title?: string): Promise<Conversation>;
  abstract update(id: string, patch: { title: string }): Promise<void>;
  abstract delete(id: OneOrMany<string>): Promise<void>;
  abstract createItems(
    conversationId: string,
    items: OneOrMany<ConversationItemInsert>,
  ): Promise<void>;
  abstract appendUserMessage(
    conversationId: string,
    item: ConversationItemInsert,
    title?: string,
  ): Promise<void>;
  abstract switchTo(conversationId: string): Promise<void>;
  abstract usageTotals(conversationId: string): Promise<UsageTotals>;
  abstract readLatestSummaryText(conversationId: string): Promise<string>;
  abstract pruneEmpty(profileId?: string): Promise<void>;
}

export class SqliteConversationFacade extends ConversationFacade {
  constructor(
    private readonly repo: ConversationRepository,
    private readonly ctx: StoreContext,
  ) {
    super();
  }

  query(): ConversationQuery {
    return this.repo.query();
  }

  queryHistory(conversationId: string): HistoryQuery {
    return new HistoryQuery(this.repo, conversationId);
  }

  create(profileId: string, title = "New chat"): Promise<Conversation> {
    return Promise.resolve(this.repo.createConversation(profileId, title));
  }

  async update(id: string, patch: { title: string }): Promise<void> {
    this.repo.updateConversation(id, patch.title);
  }

  async delete(id: OneOrMany<string>): Promise<void> {
    this.repo.deleteConversations(asArray(id));
  }

  async createItems(
    conversationId: string,
    items: OneOrMany<ConversationItemInsert>,
  ): Promise<void> {
    this.repo.insertItems(conversationId, items);
  }

  async appendUserMessage(
    conversationId: string,
    item: ConversationItemInsert,
    title?: string,
  ): Promise<void> {
    this.repo.transaction((repo) => {
      repo.insertItems(conversationId, item);
      if (title !== undefined) repo.updateConversation(conversationId, title);
    });
  }

  async switchTo(conversationId: string): Promise<void> {
    const row = await this.query().byId(conversationId).executeAndTakeFirst();
    if (!row || row.profileId !== this.ctx.profileId) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    this.ctx.bind(this.ctx.profileId, conversationId);
  }

  usageTotals(conversationId: string): Promise<UsageTotals> {
    return this.repo.usageTotals(conversationId);
  }

  readLatestSummaryText(conversationId: string): Promise<string> {
    return this.repo.readLatestSummaryText(conversationId);
  }

  async pruneEmpty(profileId?: string): Promise<void> {
    let query = this.query().withoutAssistantReply();
    if (profileId !== undefined) query = query.forProfile(profileId);
    const toRemove = await query.execute();
    await this.delete(toRemove.map((conv) => conv.id));
  }
}
