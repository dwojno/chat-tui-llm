import { describe, expect, it } from "vitest";
import { buildExitMessage } from "@/platform/cli/shutdown";
import { createMemoryStore, createMockOpenAI } from "@tests/helpers/mock-openai";
import { testSession } from "@tests/helpers/agent";

describe("buildExitMessage", () => {
  it("prunes empty conversations before printing the exit report", async () => {
    const store = await createMemoryStore();
    const emptyId = store.conversationId;
    const kept = await store.conversation.create(store.profileId, "Kept");
    await store.conversation.createItems(kept.id, {
      kind: "assistant_answer",
      turnIndex: 0,
      payload: { type: "assistant_answer", content: "hello" },
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
