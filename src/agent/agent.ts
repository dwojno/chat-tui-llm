import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses.mjs";
import type { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import type { Model } from "@/platform/model";
import type { EventBus } from "./events/bus";
import type { TurnOptions } from "./conversation/options";
import { describeToolCall, executeToolCall, toolLabel } from "./tools";
import { evaluateApproval, type ApprovalGate, type ApprovalNeed } from "./humanLayer/approval";
import type { ClarificationGate } from "./humanLayer/clarification";
import { toOpenAITool, type ForkProfiles, type ToolDefinition } from "./tools/types";
import { getFunctionCalls } from "./conversation/items";
import type { RunTurn, ToolRunContext, TurnContext, TurnProfile } from "./conversation/turn";
import { setSpanIO, withSpan } from "@/platform/telemetry";

function isReasoningModel(model: string): boolean {
  return (/^o\d/.test(model) || model.startsWith("gpt-5")) && !model.includes("chat");
}

export type { TurnContext } from "./conversation/turn";

export interface AgentDeps {
  model: Model;
  temperature: number;
  cacheKey: string;
  instructions: string;
  tools?: ToolDefinition<z.ZodType>[];
  forkProfiles?: ForkProfiles;
  redact?: (text: string) => string;
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
}

export interface ToolExecDeps {
  context: TurnContext;
  runTurn: RunTurn;
  bus: EventBus;
  requestApproval?: ApprovalGate;
  requestClarification?: ClarificationGate;
}

export class Agent {
  private readonly model: Model;
  private readonly temperature: number;
  private readonly registry: ToolDefinition<z.ZodType>[];
  private readonly forkProfiles: ForkProfiles;
  private readonly defaultProfile: TurnProfile;
  private readonly redact?: (text: string) => string;

  constructor(deps: AgentDeps) {
    const tools = deps.tools ?? [];
    this.model = deps.model;
    this.temperature = deps.temperature;
    if (deps.redact) this.redact = deps.redact;
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
    const { output, outputText, outputParsed } = await this.streamResponse({
      input: messages,
      options,
      profile,
      bus,
      forbidTools,
    });
    const toolCalls = getFunctionCalls(output);
    return {
      outputText,
      outputParsed,
      toolCalls,
      outputItems: output,
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
      return { required: tool.requiresApproval === true || tool.approvalPolicy !== undefined };
    }
  }

  private toolContext(deps: ToolExecDeps): ToolRunContext {
    return {
      model: this.model,
      forkProfiles: this.forkProfiles,
      context: deps.context,
      runTurn: deps.runTurn,
      bus: deps.bus,
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
    const items = [...input];

    return {
      model,
      operation: "chat" as const,
      input: this.redact ? redactInputItems(items, this.redact) : items,
      instructions: profile.instructions,
      ...(text ? { text } : {}),
      ...(isReasoningModel(model)
        ? { include: ["reasoning.encrypted_content"] }
        : { temperature: this.temperature }),
      ...(profile.reasoningEffort ? { reasoning: { effort: profile.reasoningEffort } } : {}),
      ...(options.max_output_tokens !== undefined
        ? { maxOutputTokens: options.max_output_tokens }
        : {}),
      store: false,
      tools: forbidTools ? [] : profile.tools,
      promptCacheKey: profile.cacheKey,
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
  }) {
    const params = this.buildRequestParams({ input, options, profile, forbidTools });
    return this.model.complete({
      ...params,
      ...(options.stream
        ? {
            stream: {
              onDelta: (text) => bus.emit({ type: "delta", text }),
            },
          }
        : {}),
    });
  }
}

const REDACT_TEXT_KEYS = new Set(["text", "arguments", "output", "content"]);

function redactValue(value: unknown, redact: (text: string) => string): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, redact));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        typeof val === "string" && REDACT_TEXT_KEYS.has(key)
          ? redact(val)
          : redactValue(val, redact),
      ]),
    );
  }
  return value;
}

export function redactInputItems(
  items: ResponseInputItem[],
  redact: (text: string) => string,
): ResponseInputItem[] {
  return items.map((item) => redactValue(item, redact)) as ResponseInputItem[];
}

function dedupeByName(tools: ToolDefinition<z.ZodType>[]): ToolDefinition<z.ZodType>[] {
  const seen = new Map<string, ToolDefinition<z.ZodType>>();
  for (const tool of tools) if (!seen.has(tool.name)) seen.set(tool.name, tool);
  return [...seen.values()];
}
