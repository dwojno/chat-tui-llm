import assert from "node:assert";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses.mjs";
import type { Agent } from "../agent/agent";
import type { EventBus } from "../agent/events/bus";
import { APPROVAL_DENIED_OUTPUT } from "../agent/humanLayer/approval";
import type { TurnOptions } from "../agent/conversation/options";
import type { RunTurnArgs, TurnContext, TurnProfile, TurnResult } from "../agent/conversation/turn";
import { formatResponse } from "../tools/format";
import { buildContextBlock } from "../context/context";

export interface RunAgentLoopArgs {
  agent: Agent;
  messages: readonly ResponseInputItem[];
  options: TurnOptions;
  context: TurnContext;
  bus: EventBus;
  maxToolSteps: number;
  profile?: TurnProfile;
}

export async function runAgentLoop(args: RunAgentLoopArgs): Promise<TurnResult> {
  const { agent, messages, options, context, bus, maxToolSteps } = args;
  const input: ResponseInputItem[] = [...messages];
  const usages: (ResponseUsage | undefined)[] = [];
  const recordUsage = (usage: ResponseUsage | undefined): void => void usages.push(usage);
  const runTurn = (a: RunTurnArgs): Promise<TurnResult> =>
    runAgentLoop({ agent, maxToolSteps, ...a });

  const advance = (result: Awaited<ReturnType<Agent["step"]>>): void => {
    input.push(...result.items);
    recordUsage(result.usage);
    emitToolCalls(agent, result.toolCalls, bus);
  };

  const contextItems = buildContextBlock({ memories: context.memories });
  const withContext = (items: readonly ResponseInputItem[]): ResponseInputItem[] => [
    ...items,
    ...contextItems,
  ];
  const stepArgs = { options, bus, ...(args.profile ? { profile: args.profile } : {}) };
  let step = await agent.step({ messages: withContext(input), ...stepArgs });
  advance(step);

  let steps = 0;
  while (step.toolCalls.length) {
    const denied = await runApprovalGate({ agent, calls: step.toolCalls, context, bus });
    const outputs = await Promise.all(
      step.toolCalls.map((call, index) => {
        const declined = denied.get(index);
        return declined !== undefined
          ? Promise.resolve(declined)
          : agent.executeTool(call, {
              context,
              messages: input,
              runTurn,
              bus,
              recordUsage,
              ...gates(context),
            });
      }),
    );
    step.toolCalls.forEach((call, index) => {
      const output = outputs[index];
      assert(output !== undefined);
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    });

    steps += 1;
    step = await agent.step({
      messages: withContext(input),
      ...stepArgs,
      forbidTools: steps >= maxToolSteps,
    });
    advance(step);
  }

  return {
    answer: formatResponse(step, options),
    items: input.slice(messages.length),
    usage: sumUsage(usages),
  };
}

function gates(context: TurnContext) {
  return {
    ...(context.requestApproval ? { requestApproval: context.requestApproval } : {}),
    ...(context.requestClarification ? { requestClarification: context.requestClarification } : {}),
  };
}

function emitToolCalls(agent: Agent, calls: ResponseFunctionToolCall[], bus: EventBus): void {
  for (const call of calls) {
    const { label, detail } = agent.toolMeta(call);
    bus.emit({
      type: "tool",
      name: call.name,
      ...(label !== undefined ? { label } : {}),
      ...(detail !== undefined ? { detail } : {}),
    });
  }
}

async function runApprovalGate(args: {
  agent: Agent;
  calls: ResponseFunctionToolCall[];
  context: TurnContext;
  bus: EventBus;
}): Promise<Map<number, string>> {
  const { agent, calls, context, bus } = args;
  const denied = new Map<number, string>();
  const gate = context.requestApproval;
  if (!gate) return denied;

  for (const [index, call] of calls.entries()) {
    const { label, detail, approval } = agent.toolMeta(call);
    if (!approval.required) continue;

    bus.emit({
      type: "approval_request",
      toolName: call.name,
      ...(label !== undefined ? { label } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(approval.reason !== undefined ? { reason: approval.reason } : {}),
      ...(approval.risk !== undefined ? { risk: approval.risk } : {}),
    });
    const decision = await gate({
      toolName: call.name,
      label,
      detail,
      reason: approval.reason,
      risk: approval.risk,
    });
    bus.emit({ type: "approval_resolved", toolName: call.name, outcome: decision.outcome });
    if (decision.outcome === "reject") denied.set(index, APPROVAL_DENIED_OUTPUT);
  }
  return denied;
}

function sumUsage(usages: (ResponseUsage | undefined)[]): ResponseUsage | undefined {
  const present = usages.filter((usage): usage is ResponseUsage => usage !== undefined);
  if (!present.length) return undefined;

  let input = 0;
  let output = 0;
  let total = 0;
  let cached = 0;
  let reasoning = 0;
  for (const usage of present) {
    input += usage.input_tokens ?? 0;
    output += usage.output_tokens ?? 0;
    total += usage.total_tokens ?? 0;
    cached += usage.input_tokens_details?.cached_tokens ?? 0;
    reasoning += usage.output_tokens_details?.reasoning_tokens ?? 0;
  }
  return {
    input_tokens: input,
    input_tokens_details: { cached_tokens: cached },
    output_tokens: output,
    output_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: total,
  };
}
