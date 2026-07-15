import { describe, expect, it } from "vitest";
import { Agent } from "@/agent/agent";
import { EventBus } from "@/agent/events/bus";
import type { TurnEvent } from "@/agent/events/events";
import { ORCHESTRATOR_MODEL, TEMPERATURE } from "@/app/config";
import { DEFAULT_TURN_OPTIONS } from "@/agent/conversation/options";
import { Session } from "@/app/session/session";
import type { Store } from "@/store";
import { createMemoryStore, createMockOpenAI, type MockTurn } from "@tests/helpers/mock-openai";

async function makeSession(
  turns: MockTurn[] = [],
  compressions: string[] = [],
  keepLastTurns = 4,
  store?: Store,
) {
  const resolvedStore = store ?? (await createMemoryStore());
  const mock = createMockOpenAI(turns, compressions);
  const bus = new EventBus();
  const events: TurnEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const agent = new Agent({
    openai: mock.client,
    temperature: TEMPERATURE,
    cacheKey: "chat-cli:test",
    instructions: "system",
  });
  const session = await Session.create(agent, mock.client, resolvedStore, keepLastTurns, bus);
  return { session, mock, store: resolvedStore, events };
}

describe("Session state", () => {
  it("starts fresh when the client is empty", async () => {
    const { session } = await makeSession();
    expect(await session.memories()).toEqual([]);
    expect(await session.sources()).toEqual([]);
    expect(await session.report()).toContain("No turns recorded");
  });

  it("persists facts and sources through the client and reloads them", async () => {
    const store = await createMemoryStore();
    const { session } = await makeSession([], [], 4, store);

    await session.addMemory("likes tea");
    await store.sources.createMany(store.profileId, ["src/a.ts", "src/b.ts", "src/c.ts"]);

    const reloaded = (await makeSession([], [], 4, store)).session;
    expect(await reloaded.memories()).toEqual(["likes tea"]);
    expect(await reloaded.sources()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});

describe("Session.runTurn", () => {
  it("returns the answer, streams deltas on the bus, and accumulates usage", async () => {
    const { session, events } = await makeSession([{ text: "hello" }]);

    const answer = await session.runTurn("hi", DEFAULT_TURN_OPTIONS);

    expect(answer).toBe("hello");
    expect(events.every((e) => e.type === "delta")).toBe(true);
    expect(events.map((e) => (e.type === "delta" ? e.text : "")).join("")).toBe("hello");

    expect(await session.getUsageTotals()).toMatchObject({
      actualInput: 100,
      output: 50,
      turns: 1,
    });
    expect(await session.report()).toContain("Context report — 1 turn");
  });

  it("renames a new chat from the first user prompt", async () => {
    const { session, store } = await makeSession([{ text: "hello" }]);
    await session.runTurn("My first question here", DEFAULT_TURN_OPTIONS);

    const row = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
    expect(row?.title).toBe("My first question he");
  });

  it("defaults the orchestrator model to ORCHESTRATOR_MODEL", async () => {
    const { session, mock } = await makeSession([{ text: "hi" }]);
    await session.runTurn("hi", DEFAULT_TURN_OPTIONS);
    const params = mock.calls.stream[0] as { model?: string };
    expect(params.model).toBe(ORCHESTRATOR_MODEL);
  });

  it("uses the profile model when set", async () => {
    const store = await createMemoryStore();
    await store.profile.update(store.profileId, { model: "gpt-4o-mini" });
    const { session, mock } = await makeSession([{ text: "hi" }], [], 4, store);
    await session.runTurn("hi", DEFAULT_TURN_OPTIONS);
    const params = mock.calls.stream[0] as { model?: string };
    expect(params.model).toBe("gpt-4o-mini");
  });

  it("summarizes and trims once the window overflows keepLastTurns", async () => {
    const turns: MockTurn[] = Array.from({ length: 5 }, (_, i) => ({
      text: `answer ${i}`,
    }));
    const { session, mock } = await makeSession(turns, ["ROLLING SUMMARY"], 4);

    for (let i = 0; i < 5; i++) {
      await session.runTurn(`question ${i}`, {
        ...DEFAULT_TURN_OPTIONS,
        stream: false,
      });
    }

    expect(mock.calls.create).toHaveLength(1);
    expect((await session.getUsageTotals()).summarizer).toBeGreaterThan(0);
  });

  it("keeps a summary + recent turns in the model window after overflow — no turn is silently dropped", async () => {
    const turns: MockTurn[] = Array.from({ length: 6 }, (_, i) => ({ text: `answer ${i}` }));
    const comps = Array.from({ length: 6 }, (_, i) => `SEGMENT ${i}`);
    const { session, store } = await makeSession(turns, comps, 4);

    for (let i = 0; i < 6; i++) {
      await session.runTurn(`question ${i}`, { ...DEFAULT_TURN_OPTIONS, stream: false });
    }

    const model = await store.conversation.queryHistory(store.conversationId).forModel().execute();
    // A summary segment stands in for the evicted turns; the latest turn stays verbatim.
    expect(model.some((e) => e.type === "summary")).toBe(true);
    expect(model.some((e) => e.type === "user_message" && e.content === "question 5")).toBe(true);
    // The oldest turn is folded into the summary — represented, not lost as before.
    expect(model.some((e) => e.type === "user_message" && e.content === "question 0")).toBe(false);
  });
});
