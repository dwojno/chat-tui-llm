import { describe, expect, it } from "vitest";
import { AgentService } from "../../src/agent/agent";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { Session } from "../../src/integration/session";
import type { Store } from "../../src/store";
import { createMemoryStore, createMockOpenAI, type MockTurn } from "../helpers/mock-openai";
import { collect } from "../../src/utils/async-gen";

async function makeSession(
  turns: MockTurn[] = [],
  compressions: string[] = [],
  keepLastTurns = 4,
  store?: Store,
) {
  const resolvedStore = store ?? (await createMemoryStore());
  const mock = createMockOpenAI(turns, compressions);
  const agent = new AgentService(mock.client);
  const session = await Session.create(agent, mock.client, resolvedStore, keepLastTurns);
  return { session, mock, store: resolvedStore };
}

describe("Session state", () => {
  it("starts fresh when the client is empty", async () => {
    const { session } = await makeSession();
    expect(await session.facts()).toEqual([]);
    expect(await session.sources()).toEqual([]);
    expect(await session.report()).toContain("No turns recorded");
  });

  it("persists facts and sources through the client and reloads them", async () => {
    const store = await createMemoryStore();
    const { session } = await makeSession([], [], 4, store);

    await session.addFact("likes tea");
    await store.sources.createMany(store.profileId, ["src/a.ts", "src/b.ts", "src/c.ts"]);

    const reloaded = (await makeSession([], [], 4, store)).session;
    expect(await reloaded.facts()).toEqual(["likes tea"]);
    expect(await reloaded.sources()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});

describe("Session.runTurn", () => {
  it("forwards presentation events and accumulates response usage", async () => {
    const { session } = await makeSession([{ text: "hello" }]);

    const events = await collect(session.runTurn("hi", DEFAULT_TURN_OPTIONS));

    expect(events.every((e) => e.type === "delta" || e.type === "answer")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "answer", content: "hello" });

    expect(await session.getUsageTotals()).toMatchObject({
      actualInput: 100,
      output: 50,
      turns: 1,
    });
    expect(await session.report()).toContain("Context report — 1 turn");
  });

  it("renames a new chat from the first user prompt", async () => {
    const { session, store } = await makeSession([{ text: "hello" }]);
    await collect(session.runTurn("My first question here", DEFAULT_TURN_OPTIONS));

    const row = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
    expect(row?.title).toBe("My first question he");
  });

  it("uses profile temperature when set", async () => {
    const store = await createMemoryStore();
    await store.profile.update(store.profileId, { temperature: 0.2 });
    const mock = createMockOpenAI([{ text: "hello" }]);
    const agent = new AgentService(mock.client);
    const session = await Session.create(agent, mock.client, store, 4);

    await collect(session.runTurn("hi", DEFAULT_TURN_OPTIONS));

    const params = mock.calls.stream[0] as { temperature?: number };
    expect(params.temperature).toBe(0.2);
  });

  it("summarizes and trims once the window overflows keepLastTurns", async () => {
    const turns: MockTurn[] = Array.from({ length: 5 }, (_, i) => ({
      text: `answer ${i}`,
    }));
    const { session, mock } = await makeSession(turns, ["ROLLING SUMMARY"], 4);

    for (let i = 0; i < 5; i++) {
      await collect(
        session.runTurn(`question ${i}`, {
          ...DEFAULT_TURN_OPTIONS,
          stream: false,
        }),
      );
    }

    expect(mock.calls.create).toHaveLength(1);
    expect((await session.getUsageTotals()).summarizer).toBeGreaterThan(0);
  });
});
