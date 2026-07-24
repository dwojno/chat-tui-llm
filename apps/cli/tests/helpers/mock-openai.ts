import type { OpenAI } from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { ForkResult } from "@chat/tools/delegation/fork-result";
import { LocalStore, type RagDeps, type Store } from "@/store";

export type MockHandoff = string | Partial<ForkResult>;

function toForkResult(entry: MockHandoff | undefined): ForkResult {
  const base: ForkResult = {
    summary: "compressed summary",
    findings: [],
    sources: null,
    confidence: "high",
    needsFollowup: null,
  };
  if (entry === undefined) return base;
  return typeof entry === "string" ? { ...base, summary: entry } : { ...base, ...entry };
}

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${counter++}`;

export function usage(overrides: Partial<ResponseUsage> = {}): ResponseUsage {
  return {
    input_tokens: 100,
    output_tokens: 50,
    total_tokens: 150,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
    ...overrides,
  } as ResponseUsage;
}

export function assistantMessage(text: string) {
  return {
    type: "message",
    id: nextId("msg"),
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function functionCall(
  name: string,
  args: string | Record<string, unknown> = {},
  callId = nextId("call"),
) {
  const serialized = typeof args === "string" ? args : JSON.stringify(args);
  return {
    type: "function_call",
    id: nextId("fc"),
    call_id: callId,
    name,
    arguments: serialized,
    status: "completed",
    parsed_arguments: typeof args === "string" ? null : args,
  };
}

export interface MockTurn {
  text?: string;
  calls?: { name: string; arguments?: string | Record<string, unknown>; callId?: string }[];
  parsed?: unknown;
  usage?: ResponseUsage;
}

function buildResponse(turn: MockTurn) {
  const output = [
    ...(turn.calls ?? []).map((c) => functionCall(c.name, c.arguments, c.callId)),
    ...(turn.text !== undefined ? [assistantMessage(turn.text)] : []),
  ];
  return {
    output,
    output_text: turn.text ?? "",
    output_parsed: turn.parsed ?? null,
    usage: turn.usage ?? usage(),
  };
}

function toDeltas(text: string): string[] {
  if (!text) return [];
  const words = text.split(/(\s+)/).filter(Boolean);
  return words.length > 1 ? words : [text];
}

function makeStream(turn: MockTurn) {
  const final = buildResponse(turn);
  const deltas = toDeltas(turn.text ?? "");
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) {
        yield { type: "response.output_text.delta", delta };
      }
    },
    finalResponse: async () => final,
  };
}

export interface MockOpenAI {
  client: OpenAI;
  calls: {
    stream: unknown[];
    parse: unknown[];
    create: unknown[];
    handoff: unknown[];
  };
  turnsRemaining: () => number;
}

function isForkResultParse(params: unknown): boolean {
  const format = (params as { text?: { format?: { name?: string } } })?.text?.format;
  return format?.name === "fork_result";
}

export function createMockOpenAI(
  turns: MockTurn[] = [],
  compressions: MockHandoff[] = [],
): MockOpenAI {
  const turnQueue = [...turns];
  const compQueue = [...compressions];
  const calls = {
    stream: [] as unknown[],
    parse: [] as unknown[],
    create: [] as unknown[],
    handoff: [] as unknown[],
  };

  const nextTurn = (): MockTurn => turnQueue.shift() ?? { text: "" };
  const compAsText = (): string => {
    const entry = compQueue.shift();
    return typeof entry === "string" ? entry : (entry?.summary ?? "compressed summary");
  };

  const client = {
    responses: {
      stream: (params: unknown) => {
        calls.stream.push(params);
        return makeStream(nextTurn());
      },
      parse: async (params: unknown) => {
        calls.parse.push(params);
        if (isForkResultParse(params)) {
          calls.handoff.push(params);
          return {
            output: [],
            output_text: "",
            output_parsed: toForkResult(compQueue.shift()),
            usage: usage(),
          };
        }
        return buildResponse(nextTurn());
      },
      create: async (params: unknown) => {
        calls.create.push(params);
        return { output_text: compAsText(), usage: usage() };
      },
    },
  };

  return {
    client: client as unknown as OpenAI,
    calls,
    turnsRemaining: () => turnQueue.length,
  };
}

export function createThrowingOpenAI(message = "API unavailable"): OpenAI {
  const fail = () => {
    throw new Error(message);
  };
  return {
    responses: {
      stream: fail,
      parse: async () => fail(),
      create: async () => fail(),
    },
  } as unknown as OpenAI;
}

export function createMemoryStore(rag?: RagDeps): Promise<Store> {
  return LocalStore.open(":memory:", rag ? { rag } : {});
}
