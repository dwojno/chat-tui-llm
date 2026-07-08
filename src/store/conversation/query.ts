import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export interface HistoryQueryConfig {
  sessionId?: string;
  afterLastSummary: boolean;
  lastTurns?: number;
  forModel: boolean;
}

export interface ForModelOptions {
  /** Cap to the last N user turns. Omit for the full unsummarized tail. */
  lastTurns?: number;
}

export type HistoryQueryExecutor = (config: HistoryQueryConfig) => Promise<ResponseInputItem[]>;

export class HistoryQuery {
  private readonly config: HistoryQueryConfig = {
    afterLastSummary: false,
    forModel: false,
  };

  constructor(private readonly executeQuery: HistoryQueryExecutor) {}

  forSession(sessionId: string): this {
    this.config.sessionId = sessionId;
    return this;
  }

  afterLastSummary(): this {
    this.config.afterLastSummary = true;
    return this;
  }

  lastTurns(n: number): this {
    this.config.lastTurns = n;
    return this;
  }

  forModel(options?: ForModelOptions): this {
    this.config.forModel = true;
    this.config.afterLastSummary = true;
    if (options?.lastTurns !== undefined) {
      this.config.lastTurns = options.lastTurns;
    }
    return this;
  }

  execute(): Promise<ResponseInputItem[]> {
    return this.executeQuery({ ...this.config });
  }
}

export function summaryDeveloperMessage(summary: string): ResponseInputItem {
  return {
    role: "developer",
    content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
  } satisfies ResponseInputItem;
}
