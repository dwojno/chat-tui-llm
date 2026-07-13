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
import { describeToolCall, executeToolCall, toolLabel } from "./tools";
import { APPROVAL_DENIED_OUTPUT, evaluateApproval, type ApprovalNeed } from "./tools/approval";
import {
  FORK_PROFILE_NAMES,
  toOpenAITool,
  type ForkProfile,
  type ForkProfiles,
  type ToolDefinition,
} from "./tools/types";
import { getFunctionCalls, hasFunctionCalls, toReplayInputItems } from "./conversation/items";
import type { ToolRunContext, TurnContext, TurnProfile } from "./conversation/turn";
import {
  bindActive,
  contextWithSpan,
  endSpan,
  isContentCaptureEnabled,
  recordCompletionStart,
  recordLlmSpan,
  setSpanIO,
  startSpan,
} from "./telemetry";
import { AgentConfig } from "./config/types";
import type { z } from "zod";
import { DEFAULT_CACHE_KEY, MAX_TOOL_STEPS, MODEL, TEMPERATURE } from "./config";
import { SYSTEM_INSTRUCTIONS } from "./prompts";

const EMPTY_CONTEXT: TurnContext = { memories: [] };

const EMPTY_FORK_PROFILE: ForkProfile = {
  instructions: "",
  tools: [],
  model: MODEL,
};
const EMPTY_FORK_PROFILES = Object.fromEntries(
  FORK_PROFILE_NAMES.map((name) => [name, EMPTY_FORK_PROFILE]),
) as ForkProfiles;

export type { TurnContext } from "./conversation/turn";

export class AgentService {
  private readonly defaultProfile: TurnProfile;
  private readonly registry: ToolDefinition<z.ZodType>[];
  private readonly forkProfiles: ForkProfiles;

  constructor(
    private readonly openai: OpenAI,
    config: AgentConfig = {},
  ) {
    const tools = config.tools ?? [];
    this.forkProfiles = config.forkProfiles ?? EMPTY_FORK_PROFILES;
    const forkTools = Object.values(this.forkProfiles).flatMap((profile) => profile.tools);
    this.registry = dedupeByName([...tools, ...forkTools]);
    this.defaultProfile = {
      instructions: config.instructions ?? SYSTEM_INSTRUCTIONS,
      tools: tools.map(toOpenAITool),
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
      model: profile.model ?? options.model,
      input: [
        ...input,
        ...buildContextBlock({
          memories: context.memories,
        }),
      ],
      instructions: profile.instructions,
      ...(text ? { text } : {}),
      temperature: TEMPERATURE,
      ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}),
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
    step = 0,
  ): AsyncGenerator<TurnEvent, ParsedResponse<unknown>> {
    const params = this.buildRequestParams(input, options, context, profile, forbidTools);
    const span = startSpan(`gen_ai.chat ${params.model}`, {
      attributes: { "gen_ai.step": step },
    });
    const startedAt = performance.now();

    try {
      let response: ParsedResponse<unknown>;
      if (options.stream) {
        const stream = this.openai.responses.stream(params);
        let firstToken = true;
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            if (firstToken) {
              recordCompletionStart(span, new Date());
              firstToken = false;
            }
            yield { type: "delta", text: event.delta };
          }
        }
        response = await stream.finalResponse();
      } else {
        response = await this.openai.responses.parse(params);
      }

      recordLlmSpan(span, {
        model: params.model,
        operation: "chat",
        usage: response.usage,
        temperature: params.temperature,
        finishReasons: response.status ? [response.status] : undefined,
        durationSeconds: (performance.now() - startedAt) / 1000,
        input: isContentCaptureEnabled() ? JSON.stringify(params.input) : undefined,
        // output_text is empty on tool-calling rounds — fall back to the raw
        // output items so the tool calls the model made are still captured.
        output: isContentCaptureEnabled()
          ? response.output_text || JSON.stringify(response.output)
          : undefined,
      });
      yield { type: "usage", kind: "response", usage: response.usage };
      endSpan(span);
      return response;
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
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
      forkProfiles: this.forkProfiles,
      ...(context.requestApproval ? { requestApproval: context.requestApproval } : {}),
      ...(context.requestClarification
        ? { requestClarification: context.requestClarification }
        : {}),
    };
  }

  private approvalFor(call: { name: string; arguments: string }): ApprovalNeed {
    const tool = this.registry.find((t) => t.name === call.name);
    if (!tool) return { required: false };
    try {
      return evaluateApproval(tool, tool.parameters.parse(JSON.parse(call.arguments)));
    } catch {
      return { required: tool.requiresApproval === true };
    }
  }

  private executeCall(
    call: { name: string; arguments: string },
    context: TurnContext,
    messages: readonly ResponseInputItem[],
  ): AsyncGenerator<TurnEvent, string> {
    const span = startSpan(`execute_tool ${call.name}`, {
      attributes: { "gen_ai.tool.name": call.name },
    });
    setSpanIO(span, { input: call.arguments });
    const { registry } = this;
    const toolContext = this.toolContext(context, messages);

    async function* body(): AsyncGenerator<TurnEvent, string> {
      try {
        const result = yield* executeToolCall(registry, call.name, call.arguments, toolContext);
        setSpanIO(span, { output: result });
        endSpan(span);
        return result;
      } catch (error) {
        endSpan(span, error);
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Keep the tool span active for the whole tool body (survives it-merge's
    // concurrent driving of parallel calls) so store-path spans nest under it.
    return bindActive(contextWithSpan(span), body());
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
        const detail = describeToolCall(this.registry, call.name, call.arguments);
        const label = toolLabel(this.registry, call.name);
        yield {
          type: "tool",
          name: call.name,
          ...(label !== undefined ? { label } : {}),
          ...(detail !== undefined ? { detail } : {}),
        };
      }

      const denied = new Map<number, string>();
      const gate = context.requestApproval;
      if (gate) {
        for (const [index, call] of calls.entries()) {
          const need = this.approvalFor(call);
          if (!need.required) continue;

          const label = toolLabel(this.registry, call.name);
          const detail = describeToolCall(this.registry, call.name, call.arguments);
          yield {
            type: "approval_request",
            toolName: call.name,
            ...(label !== undefined ? { label } : {}),
            ...(detail !== undefined ? { detail } : {}),
            ...(need.reason !== undefined ? { reason: need.reason } : {}),
            ...(need.risk !== undefined ? { risk: need.risk } : {}),
          };
          const span = startSpan(`approval ${call.name}`, {
            attributes: {
              "gen_ai.tool.name": call.name,
              ...(need.risk !== undefined ? { "approval.risk": need.risk } : {}),
            },
          });
          setSpanIO(span, { input: detail ?? call.arguments });
          try {
            const decision = await gate({
              toolName: call.name,
              label,
              detail,
              reason: need.reason,
              risk: need.risk,
            });
            span.setAttribute("approval.outcome", decision.outcome);
            setSpanIO(span, { output: decision.outcome });
            endSpan(span);
            yield {
              type: "approval_resolved",
              toolName: call.name,
              outcome: decision.outcome,
            };
            if (decision.outcome === "reject") {
              denied.set(index, APPROVAL_DENIED_OUTPUT);
            }
          } catch (error) {
            endSpan(span, error);
            throw error;
          }
        }
      }

      const { events, results } = mergeGenerators(
        calls.map((call, index) => {
          const declined = denied.get(index);
          return declined !== undefined
            ? deniedResult(declined)
            : this.executeCall(call, context, input);
        }),
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
        steps,
      );
    }

    const finalItems = toResponseInputItems(response.output);
    for (const item of finalItems) {
      yield { type: "message", item };
    }

    yield { type: "answer", content: formatResponse(response, options) };
  }
}

async function* deniedResult(output: string): AsyncGenerator<TurnEvent, string> {
  return output;
}

function dedupeByName(tools: ToolDefinition<z.ZodType>[]): ToolDefinition<z.ZodType>[] {
  const seen = new Map<string, ToolDefinition<z.ZodType>>();
  for (const tool of tools) if (!seen.has(tool.name)) seen.set(tool.name, tool);
  return [...seen.values()];
}
