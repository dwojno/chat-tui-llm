export { LocalStore, uniqueProfileName, type OpenStoreOptions, type Store } from "./store";
export type { OneOrMany } from "./helpers";
export type { Profile, ProfilePatch, ProfileFacade } from "./profile";
export type {
  Conversation,
  ConversationFacade,
  ConversationItemInsert,
  ForModelOptions,
  HistoryQuery,
  HistoryQueryConfig,
  ItemKind,
  StoredItemRow,
  TokenColumns,
} from "./conversation";
export { ZERO_TOKENS, responseUsageToTokens, summaryDeveloperMessage } from "./conversation";
export type { Fact, FactFacade } from "./fact";
export type { Source, SourcesFacade } from "./sources";

export type ConversationMeta = import("./conversation").Conversation;
export type ProfileContext = {
  name: string;
  model: string;
  sourceCount: number;
  factCount: number;
};
