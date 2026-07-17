export { LocalStore, uniqueProfileName, type OpenStoreOptions, type Store } from "./store";
export type { OneOrMany } from "./helpers";
export type { Profile, ProfilePatch, ProfileFacade } from "./profile";
export type {
  Conversation,
  ConversationFacade,
  ConversationItemInsert,
  HistoryQuery,
  HistoryQueryConfig,
  ItemKind,
  StoredItemRow,
  TokenColumns,
} from "./conversation";
export { ZERO_TOKENS, responseUsageToTokens } from "./conversation";
export type { Memory, MemoryFacade } from "./memory";
export type { McpFacade, McpServer, McpServerInput, McpTransport } from "./mcp";
export type {
  GrepMatch,
  GrepOptions,
  IndexResult,
  ReadRange,
  SearchHit,
  SearchOptions,
  Source,
  SourcesFacade,
  SourceProgress,
  SourceStatus,
} from "./sources";
export { createRagDeps, type RagConfig, type RagDeps } from "./sources";

export type ConversationMeta = import("./conversation").Conversation;
export type ProfileContext = {
  name: string;
  model: string;
  sourceCount: number;
  memoryCount: number;
};
