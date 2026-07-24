import type { OpenAI } from "openai";
import type { ParsedResponse, ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { Span } from "@opentelemetry/api";
import {
  endSpan,
  isContentCaptureEnabled,
  recordCompletionStart,
  recordLlmSpan,
  startSpan,
} from "../telemetry/index";
import { harvestUsage } from "./usage-recorder";
import type { ModelRequest, ModelResponse, ModelUsage } from "@chat/agent";

function toModelUsage(usage: ResponseUsage | undefined): ModelUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

type ResponsesParams = {
  model: string;
  input: ModelRequest["input"];
  instructions?: string;
  temperature?: number;
  max_output_tokens?: number;
  tools?: unknown[];
  prompt_cache_key?: string;
  reasoning?: { effort: "low" | "medium" | "high" };
  include?: string[];
  text?: { format: unknown };
  store: boolean;
};

function toResponsesParams(request: ModelRequest): ResponsesParams {
  return {
    model: request.model,
    input: request.input,
    store: request.store ?? false,
    ...(request.instructions !== undefined ? { instructions: request.instructions } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_output_tokens: request.maxOutputTokens }
      : {}),
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
    ...(request.promptCacheKey !== undefined ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...(request.reasoning !== undefined ? { reasoning: request.reasoning } : {}),
    ...(request.include !== undefined ? { include: request.include } : {}),
    ...(request.text !== undefined ? { text: request.text } : {}),
  };
}

function toModelResponse(
  response:
    | ParsedResponse<unknown>
    | {
        output_text: string;
        output?: unknown;
        output_parsed?: unknown;
        status?: string;
        usage?: ResponseUsage;
      },
): ModelResponse {
  const output = Array.isArray(response.output) ? response.output : [];
  return {
    outputText: response.output_text ?? "",
    outputParsed: "output_parsed" in response ? response.output_parsed : undefined,
    output,
    status: response.status,
    usage: toModelUsage(response.usage),
  };
}

export async function openAiComplete(
  client: OpenAI,
  request: ModelRequest,
): Promise<ModelResponse> {
  const params = toResponsesParams(request);
  const span = startSpan(`gen_ai.${request.operation} ${request.model}`);
  const startedAt = performance.now();

  try {
    const response = await callResponses(client, params, request, span);
    const result = toModelResponse(response);
    recordLlmSpan(span, {
      model: request.model,
      operation: request.operation,
      usage: response.usage,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(result.status ? { finishReasons: [result.status] } : {}),
      durationSeconds: (performance.now() - startedAt) / 1000,
      ...(isContentCaptureEnabled() ? { input: JSON.stringify(params.input) } : {}),
      ...(isContentCaptureEnabled()
        ? { output: result.outputText || JSON.stringify(result.output) }
        : {}),
    });
    harvestUsage(request.model, request.operation, result.usage);
    endSpan(span);
    return result;
  } catch (error) {
    endSpan(span, error);
    throw error;
  }
}

async function callResponses(
  client: OpenAI,
  params: ResponsesParams,
  request: ModelRequest,
  span: Span,
): Promise<ParsedResponse<unknown>> {
  const stream = request.stream;
  if (!stream) {
    // Summarizer is a plain text completion; everything else uses parse (tools / structured).
    if (request.operation === "summarize") {
      const created = await client.responses.create(
        params as Parameters<OpenAI["responses"]["create"]>[0],
      );
      return created as ParsedResponse<unknown>;
    }
    return client.responses.parse(params as Parameters<OpenAI["responses"]["parse"]>[0]);
  }

  const source = client.responses.stream(params as Parameters<OpenAI["responses"]["stream"]>[0]);
  let firstToken = true;
  for await (const event of source) {
    if (event.type === "response.output_text.delta") {
      if (firstToken) {
        recordCompletionStart(span, new Date());
        stream.onFirstToken?.();
        firstToken = false;
      }
      stream.onDelta(event.delta);
    }
  }
  return source.finalResponse();
}
