import { writeActiveState } from "./active-state";

export class StoreContext {
  constructor(
    private activeProfileId: string,
    private activeConversationId: string,
    readonly dbPath: string,
    readonly inMemory: boolean,
  ) {}

  get profileId(): string {
    return this.activeProfileId;
  }

  get conversationId(): string {
    return this.activeConversationId;
  }

  /**
   * Set the active profile + conversation and persist the pointer. This is the
   * single place the `active.json` pointer is written — every binding change
   * (store open, profile switch, conversation switch) flows through here.
   */
  bind(profileId: string, conversationId: string): void {
    this.activeProfileId = profileId;
    this.activeConversationId = conversationId;
    if (!this.inMemory && conversationId) {
      writeActiveState(this.dbPath, { profileId, conversationId });
    }
  }
}
