import type { Span } from "@opentelemetry/api";
import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  ParsedResponse,
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.mjs";
import type { z } from "zod";
import type { EventBus } from "./events/bus";
import type { TurnOptions } from "./conversation/options";
import { describeToolCall, executeToolCall, toolLabel } from "./tools";
import { evaluateApproval, type ApprovalGate, type ApprovalNeed } from "./humanLayer/approval";
import type { ClarificationGate } from "./humanLayer/clarification";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "./tools/types";
import { getFunctionCalls } from "./conversation/items";
import type { RunTurn, ToolRunContext, TurnContext, TurnProfile } from "./conversation/turn";
import {
  endSpan,
  isContentCaptureEnabled,
  recordCompletionStart,
  recordLlmSpan,
  setSpanIO,
  startSpan,
  withSpan,
} from "@/platform/telemetry";

function isReasoningModel(model: string): boolean {
  return (/^o\d/.test(model) || model.startsWith("gpt-5")) && !model.includes("chat");
}

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
  outputItems: ResponseOutputItem[];
  usage: ResponseUsage | undefined;
}

export interface ToolExecDeps {
  context: TurnContext;
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
    this.forkProfiles = deps.forkProfiles ?? {};
    const forkTools = Object.values(this.forkProfiles).flatMap((profile) => profile.tools);
    this.registry = dedupeByName([...tools, ...forkTools]);
    this.defaultProfile = {
      instructions: deps.instructions,
      tools: tools.map(toOpenAITool),
      cacheKey: deps.cacheKey,
    };
  }

  async step({
    messages,
    options,
    profile = this.defaultProfile,
    bus,
    forbidTools = false,
  }: StepArgs): Promise<StepResult> {
    const { output, output_text, output_parsed, usage } = await this.streamResponse({
      input: messages,
      options,
      profile,
      bus,
      forbidTools,
    });
    const toolCalls = getFunctionCalls(output);
    return {
      outputText: output_text,
      outputParsed: output_parsed,
      toolCalls,
      outputItems: output,
      usage,
    };
  }

  async executeTool(
    { name, arguments: args }: ResponseFunctionToolCall,
    deps: ToolExecDeps,
  ): Promise<string> {
    const ctx = this.toolContext(deps);
    return withSpan(
      `execute_tool ${name}`,
      { attributes: { "gen_ai.tool.name": name }, input: args },
      async (span) => {
        try {
          const result = await executeToolCall(this.registry, name, args, ctx);
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

  toolMeta({ name, arguments: args }: { name: string; arguments: string }): {
    label?: string;
    detail?: string;
    approval: ApprovalNeed;
  } {
    const label = toolLabel(this.registry, name);
    const detail = describeToolCall(this.registry, name, args);
    return {
      ...(label !== undefined ? { label } : {}),
      ...(detail !== undefined ? { detail } : {}),
      approval: this.approvalFor({ name, arguments: args }),
    };
  }

  private approvalFor({
    name: callName,
    arguments: callArgs,
  }: {
    name: string;
    arguments: string;
  }): ApprovalNeed {
    const tool = this.registry.find(({ name }) => name === callName);
    if (!tool) return { required: false };
    try {
      return evaluateApproval(tool, tool.parameters.parse(JSON.parse(callArgs)));
    } catch {
      return { required: tool.requiresApproval === true };
    }
  }

  private toolContext(deps: ToolExecDeps): ToolRunContext {
    return {
      openai: this.openai,
      forkProfiles: this.forkProfiles,
      context: deps.context,
      runTurn: deps.runTurn,
      bus: deps.bus,
      recordUsage: deps.recordUsage,
      ...(deps.requestApproval ? { requestApproval: deps.requestApproval } : {}),
      ...(deps.requestClarification ? { requestClarification: deps.requestClarification } : {}),
    };
  }

  private buildRequestParams({
    input,
    options,
    profile,
    forbidTools,
  }: {
    input: readonly ResponseInputItem[];
    options: TurnOptions;
    profile: TurnProfile;
    forbidTools: boolean;
  }) {
    const text = options.structured_output
      ? { format: zodTextFormat(options.structured_output, "response_schema") }
      : options.json_mode
        ? { format: { type: "json_object" as const } }
        : undefined;

    const model = profile.model ?? options.model;

    return {
      model,
      input: [...input],
      instructions: profile.instructions,
      ...(text ? { text } : {}),
      ...(isReasoningModel(model)
        ? { include: ["reasoning.encrypted_content" as const] }
        : { temperature: this.temperature }),
      ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}),
      ...(options.max_output_tokens !== undefined
        ? { max_output_tokens: options.max_output_tokens }
        : {}),
      store: false as const,
      tools: forbidTools ? [] : profile.tools,
      prompt_cache_key: profile.cacheKey,
    };
  }

  private async streamResponse({
    input,
    options,
    profile,
    bus,
    forbidTools,
  }: {
    input: readonly ResponseInputItem[];
    options: TurnOptions;
    profile: TurnProfile;
    bus: EventBus;
    forbidTools: boolean;
  }): Promise<ParsedResponse<unknown>> {
    const params = this.buildRequestParams({ input, options, profile, forbidTools });
    const span = startSpan(`gen_ai.chat ${params.model}`);
    const startedAt = performance.now();

    try {
      const response = await this.callModel(params, options.stream, bus, span);
      recordLlmSpan(span, {
        model: params.model,
        operation: "chat",
        usage: response.usage,
        temperature: "temperature" in params ? params.temperature : undefined,
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
