import type { UsageTotals } from "../usage";

export interface PersistedState {
  summary: string;
  facts: string[];
  sources: string[];
  usage: UsageTotals;
}

export interface ConversationStore {
  load(): PersistedState | null;
  save(state: PersistedState): void;
}
