import assert from "node:assert";
import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems.mjs";
import type { ParsedResponse, ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { buildContextBlock } from "./dynamicContext/context";
import type { TurnEvent } from "./events/events";
import { mergeGenerators } from "./events/merge";
import { formatResponse } from "./conversation/format";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "./conversation/options";
import { describeToolCall, executeToolCall, mainTools } from "./tools";
import { getFunctionCalls, hasFunctionCalls, toReplayInputItems } from "./conversation/items";
import type { ToolRunContext, TurnContext, TurnProfile } from "./conversation/turn";
import { AgentConfig } from "./config/types";
import { DEFAULT_CACHE_KEY, MAX_TOOL_STEPS } from "./config";
import { SYSTEM_INSTRUCTIONS } from "./prompts";

const EMPTY_CONTEXT: TurnContext = { facts: [] };

export type { TurnContext } from "./conversation/turn";

export class AgentService {
  private readonly defaultProfile: TurnProfile;

  constructor(
    private readonly openai: OpenAI,
    config: AgentConfig = {},
  ) {
    this.defaultProfile = {
      instructions: config.instructions ?? SYSTEM_INSTRUCTIONS,
      tools: config.tools ?? mainTools,
      cacheKey: config.cacheKey ?? DEFAULT_CACHE_KEY,
    };
  }

  private buildRequestParams(
    input: readonly ResponseInputItem[],
    options: TurnOptions,
    context: TurnContext,
    profile: TurnProfile,
    forbidTools: boolean,
  ) {
    const text = options.structured_output
      ? { format: zodTextFormat(options.structured_output, "response_schema") }
      : options.json_mode
        ? { format: { type: "json_object" as const } }
        : undefined;

    return {
      model: options.model,
      input: [
        ...input,
        ...buildContextBlock({
          facts: context.facts,
        }),
      ],
      instructions: profile.instructions,
      ...(text ? { text } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.max_output_tokens !== undefined
        ? { max_output_tokens: options.max_output_tokens }
        : {}),
      store: false as const,
      tools: forbidTools ? [] : profile.tools,
      prompt_cache_key: profile.cacheKey,
    };
  }

  private async *streamResponse(
    input: readonly ResponseInputItem[],
    options: TurnOptions,
    context: TurnContext,
    profile: TurnProfile,
    forbidTools = false,
  ): AsyncGenerator<TurnEvent, ParsedResponse<unknown>> {
    const params = this.buildRequestParams(input, options, context, profile, forbidTools);

    if (options.stream) {
      const stream = this.openai.responses.stream(params);
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "delta", text: event.delta };
        }
      }
      const final = await stream.finalResponse();
      yield { type: "usage", kind: "response", usage: final.usage };
      return final;
    }

    const response = await this.openai.responses.parse(params);
    yield { type: "usage", kind: "response", usage: response.usage };
    return response;
  }

  private toolContext(
    context: TurnContext,
    messages: readonly ResponseInputItem[],
  ): ToolRunContext {
    return {
      openai: this.openai,
      context,
      messages,
      runTurn: (msgs, options, ctx, profile) => this.run(msgs, options, ctx, profile),
    };
  }

  private async *executeCall(
    call: { name: string; arguments: string },
    context: TurnContext,
    messages: readonly ResponseInputItem[],
  ): AsyncGenerator<TurnEvent, string> {
    try {
      return yield* executeToolCall(call.name, call.arguments, this.toolContext(context, messages));
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async *run(
    messages: readonly ResponseInputItem[],
    options: TurnOptions = DEFAULT_TURN_OPTIONS,
    context: TurnContext = EMPTY_CONTEXT,
    profile: TurnProfile = this.defaultProfile,
  ): AsyncGenerator<TurnEvent, void> {
    const input: ResponseInputItem[] = [...messages];

    let response = yield* this.streamResponse(input, options, context, profile);
    let steps = 0;

    while (hasFunctionCalls(response.output)) {
      const replay = toReplayInputItems(response.output);
      input.push(...replay);
      for (const item of replay) {
        yield { type: "message", item };
      }

      const calls = getFunctionCalls(response.output);

      for (const call of calls) {
        const detail = describeToolCall(call.name, call.arguments);
        yield {
          type: "tool",
          name: call.name,
          ...(detail !== undefined ? { detail } : {}),
        };
      }

      const { events, results } = mergeGenerators(
        calls.map((call) => this.executeCall(call, context, input)),
      );
      for await (const event of events) {
        yield event;
      }
      const outputs = await results;

      for (const [index, call] of calls.entries()) {
        const output = outputs[index];
        assert(output !== undefined);
        const outputItem: ResponseInputItem = {
          type: "function_call_output",
          call_id: call.call_id,
          output,
        };
        input.push(outputItem);
        yield { type: "message", item: outputItem };
      }

      steps += 1;
      response = yield* this.streamResponse(
        input,
        options,
        context,
        profile,
        steps >= MAX_TOOL_STEPS,
      );
    }

    const finalItems = toResponseInputItems(response.output);
    for (const item of finalItems) {
      yield { type: "message", item };
    }

    yield { type: "answer", content: formatResponse(response, options) };
  }
}
