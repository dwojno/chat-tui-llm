import { describe, expect, it } from "vitest";
import { buildExitMessage } from "../../src/cli/shutdown";
import { createMemoryStore, createMockOpenAI } from "../helpers/mock-openai";
import { testSession } from "../helpers/agent";

describe("buildExitMessage", () => {
  it("prunes empty conversations before printing the exit report", async () => {
    const store = await createMemoryStore();
    const emptyId = store.conversationId;
    const kept = await store.conversation.create(store.profileId, "Kept");
    await store.conversation.createItems(kept.id, {
      kind: "message",
      turnIndex: 0,
      payload: { role: "assistant", content: "hello" },
    });
    await store.conversation.switchTo(kept.id);

    const mock = createMockOpenAI();
    const { session } = await testSession(mock.client, store);

    const message = await buildExitMessage(store, session);

    expect(await store.conversation.query().byId(emptyId).executeAndTakeFirst()).toBeNull();
    expect(message).toContain(kept.id);
    expect(message).toContain("Resume:");
  });

  it("omits the resume hint when the active conversation was pruned", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI();
    const { session } = await testSession(mock.client, store);

    const message = await buildExitMessage(store, session);

    expect(message).not.toContain("Resume:");
    expect(message).toContain("No turns recorded");
  });
});
