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

  bind(profileId: string, conversationId: string): void {
    this.activeProfileId = profileId;
    this.activeConversationId = conversationId;
  }
}
