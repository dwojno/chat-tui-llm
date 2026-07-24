import type {
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses.mjs";

export type ModelUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type ModelOperation = "chat" | "handoff" | "summarize";

export type ModelRequest = {
  model: string;
  operation: ModelOperation;
  input: string | readonly ResponseInputItem[];
  instructions?: string;
  temperature?: number;
  maxOutputTokens?: number;
  tools?: unknown[];
  promptCacheKey?: string;
  reasoning?: { effort: "low" | "medium" | "high" };
  include?: string[];
  text?: { format: unknown };
  store?: boolean;
  stream?: {
    onDelta: (text: string) => void;
    onFirstToken?: () => void;
  };
};

export type ModelResponse = {
  outputText: string;
  outputParsed: unknown;
  output: ResponseOutputItem[];
  status: string | undefined;
  usage: ModelUsage;
};

export interface Model {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
