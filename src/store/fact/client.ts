/** Pinned facts the user asked the agent to remember, scoped to the session. */
export abstract class FactClient {
  abstract add(text: string, category?: string): Promise<void>;
  abstract list(): Promise<string[]>;
}
