import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConversationStore, PersistedState } from "./types";

export class FileConversationStore implements ConversationStore {
  constructor(private readonly filePath: string) {}

  load(): PersistedState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedState;
    } catch {
      return null;
    }
  }

  save(state: PersistedState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
}
