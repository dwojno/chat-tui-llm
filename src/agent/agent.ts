import type { Span } from "@opentelemetry/api";
import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems.mjs";
import type {
  ParsedResponse,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.mjs";
import type { z } from "zod";
import type { EventBus } from "./events/bus";
import type { TurnOptions } from "./conversation/options";
import { describeToolCall, executeToolCall, toolLabel } from "./tools";
import { evaluateApproval, type ApprovalGate, type ApprovalNeed } from "./humanLayer/approval";
import type { ClarificationGate } from "./humanLayer/clarification";
import {
  FORK_PROFILE_NAMES,
  toOpenAITool,
  type ForkProfile,
  type ForkProfiles,
  type ToolDefinition,
} from "./tools/types";
import { getFunctionCalls, toReplayInputItems } from "./conversation/items";
import type { RunTurn, ToolRunContext, TurnContext, TurnProfile } from "./conversation/turn";
import {
  endSpan,
  isContentCaptureEnabled,
  recordCompletionStart,
  recordLlmSpan,
  setSpanIO,
  startSpan,
  withSpan,
} from "../telemetry";

const EMPTY_FORK_PROFILE: ForkProfile = { instructions: "", tools: [], model: "" };
const EMPTY_FORK_PROFILES = Object.fromEntries(
  FORK_PROFILE_NAMES.map((name) => [name, EMPTY_FORK_PROFILE]),
) as ForkProfiles;

export type { TurnContext } from "./conversation/turn";

export interface AgentDeps {
  openai: OpenAI;
  temperature: number;
  cacheKey: string;
  instructions: string;
  tools?: ToolDefinition<z.ZodType>[];
  forkProfiles?: ForkProfiles;
}

export interface StepArgs {
  messages: readonly ResponseInputItem[];
  options: TurnOptions;
  profile?: TurnProfile;
  bus: EventBus;
  forbidTools?: boolean;
}

export interface StepResult {
  outputText: string;
  outputParsed: unknown;
  toolCalls: ResponseFunctionToolCall[];
  items: ResponseInputItem[];
  usage: ResponseUsage | undefined;
}

export interface ToolExecDeps {
  context: TurnContext;
  messages: readonly ResponseInputItem[];
  runTurn: RunTurn;
  bus: EventBus;
  recordUsage: (usage: ResponseUsage | undefined) => void;
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}

export class Agent {
  private readonly openai: OpenAI;
  private readonly temperature: number;
  private readonly registry: ToolDefinition<z.ZodType>[];
  private readonly forkProfiles: ForkProfiles;
  private readonly defaultProfile: TurnProfile;

  constructor(deps: AgentDeps) {
    const tools = deps.tools ?? [];
    this.openai = deps.openai;
    this.temperature = deps.temperature;
    this.forkProfiles = deps.forkProfiles ?? EMPTY_FORK_PROFILES;
    const forkTools = Object.values(this.forkProfiles).flatMap((profile) => profile.tools);
    this.registry = dedupeByName([...tools, ...forkTools]);
    this.defaultProfile = {
      instructions: deps.instructions,
      tools: tools.map(toOpenAITool),
      cacheKey: deps.cacheKey,
    };
  }

  async step(args: StepArgs): Promise<StepResult> {
    const { messages, options, profile = this.defaultProfile, bus } = args;
    const response = await this.streamResponse({
      input: messages,
      options,
      profile,
      bus,
      forbidTools: args.forbidTools ?? false,
    });
    const output = response.output;
    const toolCalls = getFunctionCalls(output);
    return {
      outputText: response.output_text,
      outputParsed: response.output_parsed,
      toolCalls,
      items: toolCalls.length ? toReplayInputItems(output) : toResponseInputItems(output),
      usage: response.usage,
    };
  }

  async executeTool(call: ResponseFunctionToolCall, deps: ToolExecDeps): Promise<string> {
    const ctx = this.toolContext(deps);
    return withSpan(
      `execute_tool ${call.name}`,
      { attributes: { "gen_ai.tool.name": call.name }, input: call.arguments },
      async (span) => {
        try {
          const result = await executeToolCall(this.registry, call.name, call.arguments, ctx);
          setSpanIO(span, { output: result });
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSpanIO(span, { output: `Error: ${message}` });
          return `Error: ${message}`;
        }
      },
    );
  }

  toolMeta(call: { name: string; arguments: string }): {
    label?: string;
    detail?: string;
    approval: ApprovalNeed;
  } {
    const label = toolLabel(this.registry, call.name);
    const detail = describeToolCall(this.registry, call.name, call.arguments);
    return {
      ...(label !== undefined ? { label } : {}),
      ...(detail !== undefined ? { detail } : {}),
      approval: this.approvalFor(call),
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

  private toolContext(deps: ToolExecDeps): ToolRunContext {
    return {
      openai: this.openai,
      forkProfiles: this.forkProfiles,
      context: deps.context,
      messages: deps.messages,
      runTurn: deps.runTurn,
      bus: deps.bus,
      recordUsage: deps.recordUsage,
      ...(deps.requestApproval ? { requestApproval: deps.requestApproval } : {}),
      ...(deps.requestClarification ? { requestClarification: deps.requestClarification } : {}),
    };
  }

  private buildRequestParams(args: {
    input: readonly ResponseInputItem[];
    options: TurnOptions;
    profile: TurnProfile;
    forbidTools: boolean;
  }) {
    const { input, options, profile, forbidTools } = args;
    const text = options.structured_output
      ? { format: zodTextFormat(options.structured_output, "response_schema") }
      : options.json_mode
        ? { format: { type: "json_object" as const } }
        : undefined;

    return {
      model: profile.model ?? options.model,
      input: [...input],
      instructions: profile.instructions,
      ...(text ? { text } : {}),
      temperature: this.temperature,
      ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}),
      ...(options.max_output_tokens !== undefined
        ? { max_output_tokens: options.max_output_tokens }
        : {}),
      store: false as const,
      tools: forbidTools ? [] : profile.tools,
      prompt_cache_key: profile.cacheKey,
    };
  }

  private async streamResponse(args: {
    input: readonly ResponseInputItem[];
    options: TurnOptions;
    profile: TurnProfile;
    bus: EventBus;
    forbidTools: boolean;
  }): Promise<ParsedResponse<unknown>> {
    const params = this.buildRequestParams(args);
    const span = startSpan(`gen_ai.chat ${params.model}`);
    const startedAt = performance.now();

    try {
      const response = await this.callModel(params, args.options.stream, args.bus, span);
      recordLlmSpan(span, {
        model: params.model,
        operation: "chat",
        usage: response.usage,
        temperature: params.temperature,
        finishReasons: response.status ? [response.status] : undefined,
        durationSeconds: (performance.now() - startedAt) / 1000,
        input: isContentCaptureEnabled() ? JSON.stringify(params.input) : undefined,
        output: isContentCaptureEnabled()
          ? response.output_text || JSON.stringify(response.output)
          : undefined,
      });
      endSpan(span);
      return response;
    } catch (error) {
      endSpan(span, error);
      throw error;
    }
  }

  private async callModel(
    params: ReturnType<Agent["buildRequestParams"]>,
    stream: boolean,
    bus: EventBus,
    span: Span,
  ): Promise<ParsedResponse<unknown>> {
    if (!stream) return this.openai.responses.parse(params);

    const source = this.openai.responses.stream(params);
    let firstToken = true;
    for await (const event of source) {
      if (event.type === "response.output_text.delta") {
        if (firstToken) {
          recordCompletionStart(span, new Date());
          firstToken = false;
        }
        bus.emit({ type: "delta", text: event.delta });
      }
    }
    return source.finalResponse();
  }
}

function dedupeByName(tools: ToolDefinition<z.ZodType>[]): ToolDefinition<z.ZodType>[] {
  const seen = new Map<string, ToolDefinition<z.ZodType>>();
  for (const tool of tools) if (!seen.has(tool.name)) seen.set(tool.name, tool);
  return [...seen.values()];
}
