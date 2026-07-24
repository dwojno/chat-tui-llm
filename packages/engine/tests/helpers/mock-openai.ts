import type { OpenAI } from "openai";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";

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

export interface MockTurn {
  text?: string;
  calls?: { name: string; arguments?: string | Record<string, unknown>; callId?: string }[];
}

function buildResponse(turn: MockTurn) {
  return {
    output: [
      ...(turn.calls ?? []).map((call) => ({
        type: "function_call",
        id: nextId("fc"),
        call_id: call.callId ?? nextId("call"),
        name: call.name,
        arguments:
          typeof call.arguments === "string"
            ? call.arguments
            : JSON.stringify(call.arguments ?? {}),
        status: "completed",
      })),
      ...(turn.text === undefined
        ? []
        : [
            {
              type: "message",
              id: nextId("msg"),
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: turn.text, annotations: [] }],
            },
          ]),
    ],
    output_text: turn.text ?? "",
    output_parsed: null,
    usage: usage(),
  };
}

function makeStream(turn: MockTurn) {
  const final = buildResponse(turn);
  const deltas = (turn.text ?? "").split(/(\s+)/).filter(Boolean);
  return {
    async *[Symbol.asyncIterator]() {
      for (const delta of deltas) yield { type: "response.output_text.delta", delta };
    },
    finalResponse: async () => final,
  };
}

export function createMockOpenAI(turns: MockTurn[] = []) {
  const queue = [...turns];
  const calls = { stream: [] as unknown[] };
  const client = {
    responses: {
      stream: (params: unknown) => {
        calls.stream.push(params);
        return makeStream(queue.shift() ?? { text: "" });
      },
    },
  };
  return {
    client: client as unknown as OpenAI,
    calls,
  };
}
