import type { AgentEvent, AgentEventType } from "@chat/agent";
import type { UsageRecord } from "@chat/platform/model";

export type { UsageRecord } from "@chat/platform/model";

export type OneOrMany<T> = T | T[];

export type ItemKind = AgentEventType | "summary";

export interface ConversationItemInsert {
  kind: ItemKind;
  turnIndex: number | null;
  payload: AgentEvent | { content: string };
}

export interface Conversation {
  id: string;
  profileId: string;
  title: string;
  createdAt: number;
  lastActivityAt: number | null;
}

export interface StoredItemRow {
  id: number;
  conversationId: string;
  kind: string;
  turnIndex: number | null;
  payload: string;
  createdAt: number;
}

export interface ConversationItemQuery {
  forConversation(conversationId: string): this;
  withoutSummaries(): this;
  summariesOrAfter(boundary: number | null): this;
  afterItemId(id: number): this;
  ofKind(kind: string): this;
  orderByIdDesc(): this;
  execute(): Promise<StoredItemRow[]>;
  executeAndTakeFirst(): Promise<StoredItemRow | null>;
}

export interface ConversationQuery {
  forProfile(profileId: string): this;
  byId(id: string): this;
  orderByLastActivity(): this;
  withAssistantReply(): this;
  withoutAssistantReply(): this;
  items(): ConversationItemQuery;
  execute(): Promise<Conversation[]>;
  executeAndTakeFirst(): Promise<Conversation | null>;
}

export interface HistoryQueryConfig {
  conversationId?: string;
  afterLastSummary: boolean;
  forModel?: boolean;
}

export interface HistoryQuery {
  forConversation(conversationId: string): this;
  forSession(sessionId: string): this;
  afterLastSummary(): this;
  forModel(): this;
  execute(): Promise<AgentEvent[]>;
}

export interface UsageTotals {
  actualInput: number;
  cachedInput: number;
  output: number;
  summarizer: number;
  forkInput: number;
  managedInput: number;
  baselineInput: number;
  turns: number;
}

export interface ConversationFacade {
  query(): ConversationQuery;
  queryHistory(conversationId: string): HistoryQuery;
  create(profileId: string, title?: string): Promise<Conversation>;
  update(id: string, patch: { title: string }): Promise<void>;
  delete(id: OneOrMany<string>): Promise<void>;
  createItems(conversationId: string, items: OneOrMany<ConversationItemInsert>): Promise<void>;
  recordUsage(conversationId: string, records: OneOrMany<UsageRecord>): Promise<void>;
  listUsage(conversationId: string): Promise<UsageRecord[]>;
  appendUserMessage(
    conversationId: string,
    item: ConversationItemInsert,
    title?: string,
  ): Promise<void>;
  switchTo(conversationId: string): Promise<void>;
  usageTotals(conversationId: string): Promise<UsageTotals>;
  readLatestSummaryText(conversationId: string): Promise<string>;
  pruneEmpty(profileId?: string): Promise<void>;
}

export interface Profile {
  id: string;
  name: string;
  model: string | null;
  createdAt: number;
}

export interface ProfilePatch {
  name?: string;
  model?: string | null;
}

export interface ProfileQuery {
  byId(id: string): this;
  execute(): Promise<Profile[]>;
  executeAndTakeFirst(): Promise<Profile | null>;
}

export interface ProfileFacade {
  query(): ProfileQuery;
  create(name: string): Promise<Profile>;
  update(id: string, patch: ProfilePatch): Promise<void>;
  delete(id: OneOrMany<string>): Promise<void>;
  switchTo(profileId: string): Promise<void>;
}

export interface Memory {
  id: number;
  profileId: string;
  category: string;
  text: string;
  createdAt: number;
}

export interface MemoryQuery {
  forProfile(profileId: string): this;
  inCategory(category: string): this;
  execute(): Promise<Memory[]>;
  executeAndTakeFirst(): Promise<Memory | null>;
}

export interface MemoryFacade {
  query(): MemoryQuery;
  create(profileId: string, text: string, category?: string): Promise<Memory>;
  update(id: number, patch: { text?: string; category?: string }): Promise<void>;
  delete(id: OneOrMany<number>): Promise<void>;
}

export type McpTransport = "stdio" | "http";

export interface McpServer {
  id: number;
  profileId: string;
  label: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  enabled: boolean;
  createdAt: number;
}

export interface McpServerInput {
  label: string;
  transport: McpTransport;
  url?: string | null;
  command?: string | null;
  args?: string[];
  enabled?: boolean;
}

export interface McpFacade {
  list(profileId: string): Promise<McpServer[]>;
  add(profileId: string, input: McpServerInput): Promise<McpServer>;
  setEnabled(profileId: string, label: string, enabled: boolean): Promise<void>;
  remove(profileId: string, label: OneOrMany<string>): Promise<void>;
}

export type SourceStatus = "pending" | "indexed" | "error";

export interface Source {
  id: number;
  profileId: string;
  path: string;
  status: SourceStatus;
  s3Key: string | null;
  contentHash: string | null;
  chunkCount: number | null;
  indexedAt: number | null;
  createdAt: number;
}

export interface SourceIndexPatch {
  status: SourceStatus;
  s3Key?: string | null;
  contentHash?: string | null;
  chunkCount?: number | null;
  indexedAt?: number | null;
}

export interface SourceQuery {
  forProfile(profileId: string): this;
  execute(): Promise<Source[]>;
  executeAndTakeFirst(): Promise<Source | null>;
}

export interface SearchHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  paths?: string[];
  ignoreCase?: boolean;
  maxMatches?: number;
}

export type ReadRange =
  | { kind: "lines"; start: number; end: number }
  | { kind: "bytes"; start: number; end: number };

export interface SearchOptions {
  limit?: number;
}

export interface SourceProgress {
  message: string;
}

export interface IndexResult {
  path: string;
  chunkCount: number;
  status: "indexed" | "error";
  error?: string;
}

export interface SourcesFacade {
  query(): SourceQuery;
  create(profileId: string, path: string): Promise<Source>;
  createMany(profileId: string, paths: string[]): Promise<Source[]>;
  update(id: number, patch: { path: string }): Promise<void>;
  delete(id: OneOrMany<number>): Promise<void>;
  add(profileId: string, path: string): AsyncGenerator<SourceProgress, IndexResult>;
  reindex(profileId: string): AsyncGenerator<SourceProgress, IndexResult[]>;
  remove(profileId: string, id: number): Promise<void>;
  reset(profileId: string): Promise<void>;
  search(profileId: string, query: string, opts?: SearchOptions): Promise<SearchHit[]>;
  listFiles(profileId: string): Promise<string[]>;
  grep(profileId: string, pattern: string, opts?: GrepOptions): AsyncGenerator<GrepMatch, void>;
  readFile(profileId: string, path: string, range: ReadRange): Promise<string>;
}

export interface Store {
  readonly profileId: string;
  readonly conversationId: string;
  readonly profile: ProfileFacade;
  readonly conversation: ConversationFacade;
  readonly memory: MemoryFacade;
  readonly sources: SourcesFacade;
  readonly mcp: McpFacade;
}

export type ConversationMeta = Conversation;

export interface ProfileContext {
  name: string;
  model: string;
  sourceCount: number;
  memoryCount: number;
}
