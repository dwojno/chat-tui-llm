import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export type ItemKind = "message" | "function_call" | "function_call_output" | "summary";

export interface TokenColumns {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  summarizerTokens: number;
}

export const ZERO_TOKENS: TokenColumns = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  summarizerTokens: 0,
};

export interface ConversationItemInsert {
  kind: ItemKind;
  turnIndex: number | null;
  payload: ResponseInputItem | { content: string };
  tokens?: Partial<TokenColumns>;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  lastActivityAt: number | null;
}
