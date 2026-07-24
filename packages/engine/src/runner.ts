import assert from "node:assert";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses.mjs";
import {
  APPROVAL_DENIED_OUTPUT,
  CLARIFICATION_UNANSWERED_OUTPUT,
  type Agent,
  type AgentEvent,
  type EventBus,
  type RunTurn,
  type RunTurnArgs,
  type TurnContext,
  type TurnOptions,
  type TurnProfile,
  type TurnResult,
} from "@chat/agent";
import { formatAssistantContent, formatResponse } from "./format";
import {
  DONE_FOR_NOW_NAME,
  isControlIntent,
  parseDoneForNowArgs,
  parseRequestMoreInformationArgs,
  REQUEST_MORE_INFORMATION_NAME,
} from "./control-intents";
import { parseScratchpadArgs, UPDATE_SCRATCHPAD_NAME } from "./scratchpad";
import {
  buildMessage,
  deriveControl,
  deriveScratchpad,
  scratchpadResetOps,
} from "./thread/reducer";
import {
  canonicalizeArgs,
  eventsToInputItems,
  inputItemsToEvents,
  TOOL_ERROR_PREFIX,
  toolCallToEvent,
} from "./thread/convert";

const MAX_CALL_RETRIES = 2;
const SCRATCHPAD_SAVED_OUTPUT = "Scratchpad updated.";
const SKIPPED_OUTPUT = "Skipped — not executed this step.";

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
}

export async function runAgentLoop(args: RunAgentLoopArgs): Promise<LoopResult> {
  const { agent, options, context, bus, maxToolSteps, maxConsecutiveErrors } = args;
  const events: AgentEvent[] = [...args.events];
  const seedLength = events.length;

  const toolMemo = new Map<string, string>();
  const toolErrors = new Map<string, number>();

  const runTurn: RunTurn = (a) => forkTurn({ agent, maxToolSteps, maxConsecutiveErrors, args: a });

  const stepArgs = { options, bus, ...(args.profile ? { profile: args.profile } : {}) };
  const finish = (answer: string): LoopResult => {
    const resetOps = scratchpadResetOps(events);
    if (resetOps) {
      events.push({ type: "scratchpad", ops: resetOps });
      bus.emit({ type: "scratchpad", sections: deriveScratchpad(events) });
    }
    return {
      answer,
      events: events.slice(seedLength),
    };
  };

  let steps = 0;
  const liveItems: ResponseInputItem[] = [];
  const seed = buildMessage({ events: args.events, memories: context.memories });
  const threadOutputs = (
    calls: readonly ResponseFunctionToolCall[],
    outputs: Map<string, string>,
  ): void => {
    for (const call of calls) {
      liveItems.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: outputs.get(call.call_id) ?? SKIPPED_OUTPUT,
      });
    }
  };

  for (;;) {
    const step = await agent.step({
      messages: [...seed, ...liveItems],
      ...stepArgs,
      forbidTools: steps >= maxToolSteps,
    });
    liveItems.push(...toInputItems(step.outputItems));

    const calls = step.toolCalls;
    if (!calls.length) {
      const content = formatResponse(step, options);
      events.push({ type: "assistant_answer", content });
      return finish(content);
    }

    const done = calls.find((call) => call.name === DONE_FOR_NOW_NAME);
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
      const hint = "Reply with a plain-text answer instead.";
      events.push(malformedIntent(done, hint));
      threadOutputs(calls, new Map([[done.call_id, malformedOutput(done.name, hint)]]));
      steps += 1;
      continue;
    }

    const clarify = calls.find((call) => call.name === REQUEST_MORE_INFORMATION_NAME);
    if (clarify) {
      const parsed = tryParse(() => parseRequestMoreInformationArgs(clarify.arguments));
      if (!parsed) {
        const hint = "Ask your question in a well-formed call.";
        events.push(malformedIntent(clarify, hint));
        threadOutputs(calls, new Map([[clarify.call_id, malformedOutput(clarify.name, hint)]]));
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
      threadOutputs(calls, new Map([[clarify.call_id, answer]]));
      steps += 1;
      continue;
    }

    const outputs = new Map<string, string>();
    const padCalls = calls.filter((call) => call.name === UPDATE_SCRATCHPAD_NAME);
    for (const call of padCalls) {
      const parsed = tryParse(() => parseScratchpadArgs(call.arguments));
      if (!parsed) {
        const hint = "Provide well-formed scratchpad sections.";
        events.push(malformedIntent(call, hint));
        outputs.set(call.call_id, malformedOutput(call.name, hint));
        continue;
      }
      events.push({ type: "scratchpad", ops: parsed.sections });
      outputs.set(call.call_id, SCRATCHPAD_SAVED_OUTPUT);
    }
    if (padCalls.some((call) => outputs.get(call.call_id) === SCRATCHPAD_SAVED_OUTPUT)) {
      bus.emit({ type: "scratchpad", sections: deriveScratchpad(events) });
    }

    const work = calls.filter(
      (call) => !isControlIntent(call.name) && call.name !== UPDATE_SCRATCHPAD_NAME,
    );
    if (!work.length) {
      threadOutputs(calls, outputs);
      steps += 1;
      continue;
    }

    for (const call of work) events.push(toolCallToEvent(call));
    emitToolCalls(agent, work, bus);
    const denied = await runApprovalGate({ agent, calls: work, context, bus, events });
    const workOutputs = await dispatchWork({
      work,
      denied,
      memo: toolMemo,
      errors: toolErrors,
      execute: (call) =>
        agent.executeTool(call, {
          context,
          runTurn,
          bus,
          ...gates(context),
        }),
    });
    work.forEach((call, index) => {
      const output = workOutputs[index];
      assert(output !== undefined);
      events.push(resultEvent(call, output));
      outputs.set(call.call_id, output);
    });
    threadOutputs(calls, outputs);

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
      liveItems.push({ role: "user", content: answer });
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
  }));
}

function tryParse<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function toInputItems(items: readonly ResponseOutputItem[]): ResponseInputItem[] {
  return items.map(
    (item): ResponseInputItem =>
      item.type === "function_call"
        ? {
            type: "function_call",
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments,
          }
        : (item as ResponseInputItem),
  );
}

function malformedMessage(name: string, hint: string): string {
  return `The ${name} arguments were invalid or incomplete. ${hint}`;
}

function malformedIntent(call: ResponseFunctionToolCall, hint: string): AgentEvent {
  return {
    type: "error",
    id: call.call_id,
    name: call.name,
    message: malformedMessage(call.name, hint),
  };
}

function malformedOutput(name: string, hint: string): string {
  return `${TOOL_ERROR_PREFIX}${malformedMessage(name, hint)}`;
}

async function dispatchWork(args: {
  work: ResponseFunctionToolCall[];
  denied: Map<number, string>;
  execute: (call: ResponseFunctionToolCall) => Promise<string>;
  memo: Map<string, string>;
  errors: Map<string, number>;
}): Promise<string[]> {
  const { work, denied, execute, memo, errors } = args;
  const inFlight = new Map<string, Promise<string>>();

  return Promise.all(
    work.map(async (call, index) => {
      const declined = denied.get(index);
      if (declined !== undefined) return declined;

      const key = `${call.name}:${canonicalizeArgs(call.arguments)}`;
      const cached = memo.get(key);
      if (cached !== undefined) return cached;
      if ((errors.get(key) ?? 0) >= MAX_CALL_RETRIES) return circuitBreakOutput(call.name);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = execute(call).then((output) => {
        if (output.startsWith(TOOL_ERROR_PREFIX)) {
          errors.set(key, (errors.get(key) ?? 0) + 1);
        } else {
          memo.set(key, output);
        }
        return output;
      });
      inFlight.set(key, promise);
      return promise;
    }),
  );
}

function circuitBreakOutput(name: string): string {
  return `${TOOL_ERROR_PREFIX}${name} keeps failing with the same arguments — don't retry it; take a different approach or tool.`;
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
