import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenAI } from "openai";
import { Agent } from "../../src/agent/agent";
import { EventBus } from "../../src/agent/events/bus";
import { SYSTEM_INSTRUCTIONS } from "../../src/prompts";
import { processLine } from "../../src/input/repl";
import type { CommandContext } from "../../src/commands/types";
import { createAgentTools } from "../../src/tools";
import { Session } from "../../src/integration/session";
import { LocalStore, type Store } from "../../src/store";
import { renderChat, type ChatHandle, type Message } from "../../src/ui/chat";
import { createMockOpenAI, createMemoryStore, type MockTurn } from "../helpers/mock-openai";

export interface E2EHarness {
  chat: ChatHandle;
  session: Session;
  store: Store;
  ctx: CommandContext;
  run: (line: string) => Promise<"exit" | "continue">;
  lastAssistant: () => Message | undefined;
  queuePicker: (...choices: (string | "create" | null)[]) => void;
  queuePrompt: (...values: (string | null)[]) => void;
}

export function createTempDbDir(): string {
  return mkdtempSync(join(tmpdir(), "chat-e2e-"));
}

export function tempDbPath(dir: string): string {
  return join(dir, "chat.db");
}

export async function createE2EHarness(opts?: {
  turns?: MockTurn[];
  compressions?: string[];
  store?: Store;
  client?: OpenAI;
}): Promise<E2EHarness> {
  const store = opts?.store ?? (await createMemoryStore());
  const mock = opts?.client ? null : createMockOpenAI(opts?.turns ?? [], opts?.compressions ?? []);
  const client = opts?.client ?? mock!.client;
  const { tools, forkProfiles } = createAgentTools(store);
  const bus = new EventBus();
  const agent = new Agent({
    openai: client,
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: SYSTEM_INSTRUCTIONS,
    tools,
    forkProfiles,
  });
  const session = await Session.create(agent, client, store, 4, bus);
  const chat = renderChat([], { interactive: false, conversationId: store.conversationId });

  const pickerQueue: (string | "create" | null)[] = [];
  const promptQueue: (string | null)[] = [];

  chat.pickEntity = async () => {
    const next = pickerQueue.shift();
    if (next === undefined) throw new Error("unexpected pickEntity call");
    return next;
  };
  chat.promptInModal = async () => {
    const next = promptQueue.shift();
    if (next === undefined) throw new Error("unexpected promptInModal call");
    return next;
  };

  const ctx: CommandContext = { session, chat };

  return {
    chat,
    session,
    store,
    ctx,
    run: (line) => processLine(line, ctx, chat, session, bus),
    lastAssistant: () => [...chat.messages].toReversed().find((m) => m.role === "assistant"),
    queuePicker: (...choices) => {
      pickerQueue.push(...choices);
    },
    queuePrompt: (...values) => {
      promptQueue.push(...values);
    },
  };
}

export async function openFileStore(dir: string): Promise<Store> {
  return LocalStore.open(tempDbPath(dir));
}
