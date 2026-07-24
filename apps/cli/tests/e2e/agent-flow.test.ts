import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("ink", () => ({
  render: () => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: () => Promise.resolve(),
  }),
  Box: (props: { children?: unknown }) => props.children,
  Text: (props: { children?: unknown }) => props.children,
  Static: () => null,
  useInput: () => {},
}));

import { processLine } from "@/app/input/repl";
import type { CommandContext } from "@/app/commands/types";
import { Model } from "@/platform/model";
import { Agent } from "@chat/agent/agent";
import { EventBus } from "@chat/agent/events/bus";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { createAgentTools } from "@/app/tools";
import { Session } from "@/app/session/session";
import { renderChat, type ChatHandle, type Message } from "@/ui/chat";
import {
  createMemoryStore,
  createMockOpenAI,
  createThrowingOpenAI,
  type MockTurn,
} from "@tests/helpers/mock-openai";
import type { OpenAI } from "openai";

let dir: string;

interface Harness {
  chat: ChatHandle;
  session: Session;
  ctx: CommandContext;
  run: (line: string) => Promise<"exit" | "continue">;
  lastAssistant: () => Message | undefined;
  toolOutputs: () => Promise<string[]>;
}

async function setup(client: OpenAI): Promise<Harness> {
  const store = await createMemoryStore();
  const { tools, forkProfiles } = createAgentTools(store);
  const bus = new EventBus();
  const agent = new Agent({
    model: Model.fromOpenAI(client),
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: SYSTEM_INSTRUCTIONS,
    tools,
    forkProfiles,
  });
  const session = await Session.create(agent, Model.fromOpenAI(client), store, 4, bus);
  const chat = renderChat([], { interactive: false });
  const ctx: CommandContext = { session, chat, store };
  return {
    chat,
    session,
    ctx,
    run: (line) => processLine(line, ctx, chat, session, bus),
    lastAssistant: () => [...chat.messages].toReversed().find((m) => m.role === "assistant"),
    toolOutputs: async () =>
      (await session.history()).flatMap((e) =>
        e.type === "tool_result" ? [e.output] : e.type === "error" ? [`Error: ${e.message}`] : [],
      ),
  };
}

const mocked = async (turns: MockTurn[], compressions: string[] = []): Promise<Harness> =>
  setup(createMockOpenAI(turns, compressions).client);

function stubFetch(impl: () => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => impl()),
  );
}
const searchHits = (hits: { title: string; snippet: string }[]) => ({
  ok: true,
  json: async () => ({ query: { search: hits } }),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chat-e2e-"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("E2E: happy paths", () => {
  it("answers a plain message", async () => {
    const h = await mocked([{ text: "Hello!" }]);
    await h.run("hi there");
    expect(h.chat.messages).toEqual([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "Hello!", steps: undefined },
    ]);
  });

  it("/remember pins a fact without a model turn", async () => {
    const h = await mocked([]);
    const result = await h.run("/remember I like tea");
    expect(result).toBe("continue");
    expect(await h.session.memories()).toContain("I like tea");
    expect(h.lastAssistant()?.content).toContain("Remembered");
  });

  it("exit stops the loop", async () => {
    const h = await mocked([]);
    expect(await h.run("exit")).toBe("exit");
    expect(h.chat.messages).toEqual([]);
  });

  it("renders structured output as answer + sources", async () => {
    const h = await mocked([{ text: "", parsed: { answer: "42", sources: ["s1"] } }]);
    await h.run("/structured what is the answer?");
    expect(h.lastAssistant()?.content).toBe("42\n\nSources: s1");
  });

  it("injects resolved @file paths for the model while keeping @refs in the transcript", async () => {
    const mock = createMockOpenAI([{ text: "summarized" }]);
    const h = await setup(mock.client);
    const fixture = "apps/cli/tests/fixtures/small.txt";

    await h.run(`summarize @${fixture}`);

    expect(h.chat.messages[0]).toEqual({
      role: "user",
      content: `summarize @${fixture}`,
    });
    const transcript = await h.session.history();
    expect(transcript[0]).toMatchObject({
      type: "user_message",
      content: expect.stringContaining(fixture),
    });
    expect(transcript[0]).not.toMatchObject({
      content: expect.stringContaining(`@${fixture}`),
    });
    expect(transcript[0]).not.toMatchObject({
      content: expect.stringContaining("hello from fixture"),
    });
    expect(h.lastAssistant()?.content).toBe("summarized");
  });
});

describe("E2E: bad LLM output", () => {
  it("renders an empty answer when structured output fails to parse", async () => {
    const h = await mocked([{ text: "", parsed: null }]);
    await h.run("/structured give me json");
    expect(h.lastAssistant()).toMatchObject({ role: "assistant", content: "" });
  });

  it("commits an empty assistant turn when the model returns no text", async () => {
    const h = await mocked([{ text: "" }]);
    await h.run("say nothing");
    expect(h.lastAssistant()?.content).toBe("");
  });
});

describe("E2E: tool-call failures recover via the error-output path", () => {
  it("unknown tool → error fed back → model recovers", async () => {
    const h = await mocked([
      { calls: [{ name: "do_magic", arguments: {} }] },
      { text: "I could not do that, here is a normal answer." },
    ]);
    await h.run("do magic");
    expect((await h.toolOutputs())[0]).toMatch(/Unknown tool: do_magic/);
    expect(h.lastAssistant()?.content).toContain("normal answer");
  });

  it("malformed tool arguments → schema error fed back → recovers", async () => {
    const h = await mocked([
      { calls: [{ name: "get_weather_data", arguments: {} }] }, // missing `city`
      { text: "Which city did you mean?" },
    ]);
    await h.run("weather?");
    expect((await h.toolOutputs())[0]).toMatch(/^Error:/);
    expect(h.lastAssistant()?.content).toContain("city");
  });

  it("invalid JSON arguments → parse error fed back → recovers", async () => {
    const h = await mocked([
      { calls: [{ name: "get_weather_data", arguments: "not json" }] },
      { text: "recovered from bad json" },
    ]);
    await h.run("weather?");
    expect((await h.toolOutputs())[0]).toMatch(/^Error:/);
    expect(h.lastAssistant()?.content).toContain("recovered");
  });

  it("caps runaway tool loops and forces an answer (MAX_TOOL_STEPS)", async () => {
    const turns: MockTurn[] = Array.from({ length: 8 }, () => ({
      calls: [{ name: "do_magic", arguments: {} }],
    }));
    turns.push({ text: "forced final answer" });
    const h = await mocked(turns);
    await h.run("loop please");
    expect(await h.toolOutputs()).toHaveLength(8);
    expect(h.lastAssistant()?.content).toBe("forced final answer");
  });
});

describe("E2E: model/API failure", () => {
  it("surfaces an API error in the transcript instead of crashing the REPL", async () => {
    const h = await setup(createThrowingOpenAI("API down"));
    const result = await h.run("hello");
    expect(result).toBe("continue");
    expect(h.lastAssistant()?.content).toBe("⚠️ API down");
  });
});

describe("E2E: delegation", () => {
  it("streams the sub-agent tool activity and folds in the handoff", async () => {
    stubFetch(() => searchHits([{ title: "SSR", snippet: "renders on the <b>server</b>" }]));
    const h = await mocked(
      [
        {
          calls: [
            {
              name: "delegate_task",
              arguments: {
                title: "Research SSR",
                task: "research ssr",
                relevantMemoryKeys: null,
                profile: null,
              },
            },
          ],
        },
        { calls: [{ name: "web_search", arguments: { query: "ssr" } }] }, // child
        { text: "child done" }, // child answer
        { text: "Final synthesized answer." }, // main
      ],
      ["HANDOFF DIGEST"],
    );

    await h.run("research ssr for me");

    const assistant = h.lastAssistant();
    expect(assistant?.content).toBe("Final synthesized answer.");
    expect(assistant?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Searching the web",
          detail: "ssr",
          fork: "Research SSR",
        }),
      ]),
    );
  });

  it("isolates an ERROR on a sub-agent tool call — the fork recovers and the parent still answers", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });
    const h = await mocked(
      [
        {
          calls: [
            {
              name: "delegate_task",
              arguments: {
                title: "Research",
                task: "research",
                relevantMemoryKeys: null,
                profile: null,
              },
            },
          ],
        },
        { calls: [{ name: "web_search", arguments: { query: "q" } }] }, // child search fails
        { text: "child answered from knowledge" }, // child recovers
        { text: "parent final answer" },
      ],
      ["DIGEST"],
    );

    await h.run("research something");
    expect(h.lastAssistant()?.content).toBe("parent final answer");
  });

  it("isolates a TIMEOUT on a sub-agent tool call the same way", async () => {
    stubFetch(() => {
      throw Object.assign(new Error("The operation timed out"), {
        name: "TimeoutError",
      });
    });
    const h = await mocked(
      [
        {
          calls: [
            {
              name: "delegate_task",
              arguments: {
                title: "Research",
                task: "research",
                relevantMemoryKeys: null,
                profile: null,
              },
            },
          ],
        },
        { calls: [{ name: "web_search", arguments: { query: "q" } }] },
        { text: "child continued despite the timeout" },
        { text: "parent answer after timeout" },
      ],
      ["DIGEST"],
    );

    await h.run("research something");
    expect(h.lastAssistant()?.content).toBe("parent answer after timeout");
  });

  it("malformed delegate arguments → error fed back → recovers", async () => {
    const h = await mocked([
      { calls: [{ name: "delegate_task", arguments: { title: "X" } }] }, // missing `task`
      { text: "handled the bad delegation" },
    ]);
    await h.run("delegate badly");
    expect((await h.toolOutputs())[0]).toMatch(/^Error:/);
    expect(h.lastAssistant()?.content).toContain("handled");
  });

  it("runs multiple delegations in one turn (parallel forks)", async () => {
    const mock = createMockOpenAI(
      [
        {
          calls: [
            {
              name: "delegate_task",
              arguments: { title: "Task A", task: "a", relevantMemoryKeys: null, profile: null },
            },
            {
              name: "delegate_task",
              arguments: { title: "Task B", task: "b", relevantMemoryKeys: null, profile: null },
            },
          ],
        },
        { text: "child A done" }, // one child (direct answer, no tool)
        { text: "child B done" }, // other child
        { text: "combined answer" }, // main
      ],
      ["DIGEST A", "DIGEST B"],
    );
    const h = await setup(mock.client);

    await h.run("do two things");

    expect(h.lastAssistant()?.content).toBe("combined answer");
    // Both delegations surfaced as steps, and both forks were compressed.
    const delegations = (h.lastAssistant()?.steps ?? []).filter((s) => s.label === "Delegating");
    expect(delegations.map((s) => s.detail)).toEqual(expect.arrayContaining(["Task A", "Task B"]));
    expect(mock.calls.handoff).toHaveLength(2);
  });
});
