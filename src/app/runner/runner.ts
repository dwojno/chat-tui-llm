import assert from "node:assert";
import type {
  ResponseFunctionToolCall,
  ResponseUsage,
} from "openai/resources/responses/responses.mjs";
import type { Agent } from "@/agent/agent";
import type { EventBus } from "@/agent/events/bus";
import { APPROVAL_DENIED_OUTPUT } from "@/agent/humanLayer/approval";
import { CLARIFICATION_UNANSWERED_OUTPUT } from "@/agent/humanLayer/clarification";
import type { TurnOptions } from "@/agent/conversation/options";
import type {
  RunTurn,
  RunTurnArgs,
  TurnContext,
  TurnProfile,
  TurnResult,
} from "@/agent/conversation/turn";
import { formatAssistantContent, formatResponse } from "@/app/tools/format";
import {
  DONE_FOR_NOW_NAME,
  isControlIntent,
  parseDoneForNowArgs,
  parseRequestMoreInformationArgs,
  REQUEST_MORE_INFORMATION_NAME,
} from "@/app/tools/control-intents";
import type { AgentEvent } from "./thread/events";
import { buildMessage, deriveControl } from "./thread/reducer";
import {
  eventsToInputItems,
  inputItemsToEvents,
  TOOL_ERROR_PREFIX,
  toolCallToEvent,
} from "./thread/convert";

export interface RunAgentLoopArgs {
  agent: Agent;
  events: readonly AgentEvent[];
  options: TurnOptions;
  context: TurnContext;
  bus: EventBus;
  maxToolSteps: number;
  maxConsecutiveErrors: number;
  profile?: TurnProfile;
}

export interface LoopResult {
  answer: string;
  events: AgentEvent[];
  usage: ResponseUsage | undefined;
}

export async function runAgentLoop(args: RunAgentLoopArgs): Promise<LoopResult> {
  const { agent, options, context, bus, maxToolSteps, maxConsecutiveErrors } = args;
  const events: AgentEvent[] = [...args.events];
  const seedLength = events.length;
  const usages: (ResponseUsage | undefined)[] = [];
  const recordUsage = (usage: ResponseUsage | undefined): void => void usages.push(usage);

  const runTurn: RunTurn = (a) => forkTurn({ agent, maxToolSteps, maxConsecutiveErrors, args: a });

  const stepArgs = { options, bus, ...(args.profile ? { profile: args.profile } : {}) };
  const finish = (answer: string): LoopResult => ({
    answer,
    events: events.slice(seedLength),
    usage: sumUsage(usages),
  });

  let steps = 0;
  for (;;) {
    const input = buildMessage({ events, memories: context.memories });
    const step = await agent.step({
      messages: input,
      ...stepArgs,
      forbidTools: steps >= maxToolSteps,
    });
    recordUsage(step.usage);

    const done = step.toolCalls.find((call) => call.name === DONE_FOR_NOW_NAME);
    if (done) {
      const parsed = tryParse(() => parseDoneForNowArgs(done.arguments));
      if (parsed) {
        const content = formatAssistantContent(parsed.answer, parsed.sources ?? undefined);
        events.push({
          type: "assistant_answer",
          content,
          ...(parsed.sources?.length ? { sources: parsed.sources } : {}),
        });
        return finish(content);
      }
      events.push(malformedIntent(done, "Reply with a plain-text answer instead."));
      steps += 1;
      continue;
    }

    const clarify = step.toolCalls.find((call) => call.name === REQUEST_MORE_INFORMATION_NAME);
    if (clarify) {
      const parsed = tryParse(() => parseRequestMoreInformationArgs(clarify.arguments));
      if (!parsed) {
        events.push(malformedIntent(clarify, "Ask your question in a well-formed call."));
        steps += 1;
        continue;
      }
      const { question, reason, options: choices } = parsed;
      events.push({
        type: "clarification_request",
        question,
        ...(choices?.length ? { options: choices } : {}),
      });
      const answer = await requestClarification({
        context,
        bus,
        question,
        reason,
        options: choices,
      });
      events.push({ type: "human_response", content: answer });
      steps += 1;
      continue;
    }

    const work = step.toolCalls.filter((call) => !isControlIntent(call.name));
    if (!work.length) {
      const content = formatResponse(step, options);
      events.push({ type: "assistant_answer", content });
      return finish(content);
    }

    for (const call of work) events.push(toolCallToEvent(call));
    emitToolCalls(agent, work, bus);
    const denied = await runApprovalGate({ agent, calls: work, context, bus, events });
    const outputs = await Promise.all(
      work.map((call, index) => {
        const declined = denied.get(index);
        return declined !== undefined
          ? Promise.resolve(declined)
          : agent.executeTool(call, { context, runTurn, bus, recordUsage, ...gates(context) });
      }),
    );
    work.forEach((call, index) => {
      const output = outputs[index];
      assert(output !== undefined);
      events.push(resultEvent(call, output));
    });

    if (
      context.requestClarification &&
      deriveControl(events).consecutiveErrors >= maxConsecutiveErrors
    ) {
      const question =
        "I've hit repeated tool errors and can't make progress. How would you like me to proceed?";
      events.push({ type: "clarification_request", question });
      const answer = await requestClarification({
        context,
        bus,
        question,
        reason: null,
        options: null,
      });
      events.push({ type: "human_response", content: answer });
    }

    steps += 1;
  }
}

async function forkTurn(deps: {
  agent: Agent;
  maxToolSteps: number;
  maxConsecutiveErrors: number;
  args: RunTurnArgs;
}): Promise<TurnResult> {
  const { agent, maxToolSteps, maxConsecutiveErrors, args } = deps;
  return runAgentLoop({
    agent,
    maxToolSteps,
    maxConsecutiveErrors,
    events: inputItemsToEvents(args.messages),
    options: args.options,
    context: args.context,
    bus: args.bus,
    ...(args.profile ? { profile: args.profile } : {}),
  }).then((result) => ({
    answer: result.answer,
    items: eventsToInputItems(result.events),
    usage: result.usage,
  }));
}

function tryParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function malformedIntent(call: ResponseFunctionToolCall, hint: string): AgentEvent {
  return {
    type: "error",
    id: call.call_id,
    name: call.name,
    message: `The ${call.name} arguments were invalid or incomplete. ${hint}`,
  };
}

function resultEvent(call: ResponseFunctionToolCall, output: string): AgentEvent {
  return output.startsWith(TOOL_ERROR_PREFIX)
    ? {
        type: "error",
        id: call.call_id,
        name: call.name,
        message: output.slice(TOOL_ERROR_PREFIX.length),
      }
    : { type: "tool_result", id: call.call_id, name: call.name, output };
}

function gates(context: TurnContext) {
  return {
    ...(context.requestApproval ? { requestApproval: context.requestApproval } : {}),
    ...(context.requestClarification ? { requestClarification: context.requestClarification } : {}),
  };
}

async function requestClarification(args: {
  context: TurnContext;
  bus: EventBus;
  question: string;
  reason: string | null;
  options: string[] | null;
}): Promise<string> {
  const { context, bus, question, reason, options } = args;
  if (!context.requestClarification) return CLARIFICATION_UNANSWERED_OUTPUT;
  bus.emit({ type: "status", text: "Waiting for your answer…" });
  const { answer } = await context.requestClarification({
    question,
    ...(reason ? { reason } : {}),
    ...(options?.length ? { options } : {}),
  });
  return answer === null ? CLARIFICATION_UNANSWERED_OUTPUT : `The user answered: "${answer}"`;
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
  events: AgentEvent[];
}): Promise<Map<number, string>> {
  const { agent, calls, context, bus, events } = args;
  const denied = new Map<number, string>();
  const gate = context.requestApproval;
  if (!gate) return denied;

  for (const [index, call] of calls.entries()) {
    const { label, detail, approval } = agent.toolMeta(call);
    if (!approval.required) continue;

    events.push({
      type: "approval_request",
      id: call.call_id,
      name: call.name,
      ...(approval.reason !== undefined ? { reason: approval.reason } : {}),
      ...(approval.risk !== undefined ? { risk: approval.risk } : {}),
    });
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
    events.push({
      type: "approval_response",
      id: call.call_id,
      outcome: decision.outcome === "reject" ? "reject" : "approve",
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
