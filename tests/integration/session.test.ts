import { describe, expect, it } from "vitest";
import { AgentService } from "../../src/agent/agent";
import type { TurnEvent } from "../../src/agent/events/events";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { Session } from "../../src/integration/session";
import { createMemoryStore, createMockOpenAI, type MockTurn } from "../helpers/mock-openai";

function makeSession(
  turns: MockTurn[] = [],
  compressions: string[] = [],
  keepLastTurns = 4,
  store = createMemoryStore(),
) {
  const mock = createMockOpenAI(turns, compressions);
  const agent = new AgentService(mock.client);
  const session = new Session(agent, mock.client, store, keepLastTurns);
  return { session, mock, store };
}

async function drain(gen: AsyncGenerator<TurnEvent, void>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("Session state", () => {
  it("starts fresh when the store is empty", () => {
    const { session } = makeSession();
    expect(session.summary).toBe("");
    expect(session.facts).toEqual([]);
    expect(session.sources).toEqual([]);
    expect(session.report()).toContain("No turns recorded");
  });

  it("persists facts and sources through the store and reloads them", () => {
    const store = createMemoryStore();
    const { session } = makeSession([], [], 4, store);

    session.addFact("likes tea");
    expect(session.addSources(["src/a.ts", "src/b.ts"])).toEqual(["src/a.ts", "src/b.ts"]);
    expect(session.addSources(["src/b.ts", "src/c.ts"])).toEqual(["src/c.ts"]);

    // A new Session over the same store sees the persisted state.
    const reloaded = makeSession([], [], 4, store).session;
    expect(reloaded.facts).toEqual(["likes tea"]);
    expect(reloaded.sources).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});

describe("Session.runTurn", () => {
  it("forwards presentation events and accumulates response usage", async () => {
    const { session } = makeSession([{ text: "hello" }]);

    const events = await drain(session.runTurn("hi", DEFAULT_TURN_OPTIONS));

    // The Session consumes message/usage events and forwards only presentation.
    expect(events.every((e) => e.type === "delta" || e.type === "answer")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "answer", content: "hello" });

    // Mock usage is input 100 / output 50; one completed turn.
    expect(session.usageTotals).toMatchObject({
      actualInput: 100,
      output: 50,
      turns: 1,
    });
    expect(session.report()).toContain("Context report — 1 turn");
  });

  it("summarizes and trims once the window overflows keepLastTurns", async () => {
    const turns: MockTurn[] = Array.from({ length: 5 }, (_, i) => ({
      text: `answer ${i}`,
    }));
    const { session, mock } = makeSession(turns, ["ROLLING SUMMARY"], 4);

    for (let i = 0; i < 5; i++) {
      await drain(
        session.runTurn(`question ${i}`, {
          ...DEFAULT_TURN_OPTIONS,
          stream: false,
        }),
      );
    }

    expect(mock.calls.create).toHaveLength(1); // one summarizer call
    expect(session.summary).toBe("ROLLING SUMMARY");
  });
});
