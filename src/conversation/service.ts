import type { OpenAI } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems.mjs";
import type { ParsedResponse, ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { KEEP_LAST_TURNS, MODEL, SYSTEM_INSTRUCTIONS } from "../config";
import { buildContextBlock } from "./context";
import type { TurnEvent } from "./events";
import { EventQueue } from "./event-queue";
import { formatResponse } from "./format";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "./options";
import { describeToolCall, executeToolCall, forkTools, mainTools } from "../tools";
import { DELEGATE_TASK_NAME, parseDelegateTaskArgs } from "../tools/delegate-task";
import {
  countUserTurns,
  getFunctionCalls,
  hasFunctionCalls,
  renderItemsText,
  splitAtLastTurns,
  toReplayInputItems,
} from "./items";
import { runFork } from "./fork";
import type { ConversationScope } from "./scope";
import { estimateTokens } from "./state";
import { summarize } from "./summarizer";

type OpenAITool = (typeof mainTools)[number] | (typeof forkTools)[number];

/**
 * Upper bound on tool-call rounds in a single turn. On the last allowed round we
 * re-request with tools disabled, forcing the model to answer instead of looping
 * forever on a tool it keeps re-calling.
 */
const MAX_TOOL_STEPS = 8;

/** The result of running one tool call: its output plus any fork handoff to inject. */
type CallOutcome = {
  output: string;
  handoff?: { task: string; digest: string };
};

/**
 * Drain a generator's yielded events to `emit`, returning its final value.
 * Bridges a generator (fork) into the push-based {@link EventQueue}: `for await`
 * would discard the return value, so we step it by hand to keep the digest.
 */
async function drainEvents<R>(
  gen: AsyncGenerator<TurnEvent, R>,
  emit: (event: TurnEvent) => void,
): Promise<R> {
  let next = await gen.next();
  while (!next.done) {
    emit(next.value);
    next = await gen.next();
  }
  return next.value;
}

/** The model-provided short title for a delegate call, for the trace step. */
function describeTask(argumentsJson: string): string {
  try {
    return parseDelegateTaskArgs(argumentsJson).title;
  } catch {
    return "a sub-agent";
  }
}

export type ServiceOptions = {
  instructions?: string;
  tools?: OpenAITool[];
  keepLastTurns?: number;
};

export class ConversationService {
  private conversation: ResponseInputItem[] = [];
  private readonly instructions: string;
  private readonly tools: OpenAITool[];
  private readonly keepLastTurns: number;

  constructor(
    private readonly openai: OpenAI,
    private readonly scope: ConversationScope,
    options: ServiceOptions = {},
  ) {
    this.instructions = options.instructions ?? SYSTEM_INSTRUCTIONS;
    this.tools = options.tools ?? mainTools;
    this.keepLastTurns = options.keepLastTurns ?? KEEP_LAST_TURNS;
  }

  get items(): readonly ResponseInputItem[] {
    return this.conversation;
  }

  pushUserMessage(content: string): ResponseInputItem {
    const message = { role: "user", content } satisfies ResponseInputItem;
    this.conversation.push(message);
    this.scope.growNaive?.(`user: ${content}`);
    return message;
  }

  /** Inject a compressed fork handoff into the main transcript. */
  injectForkHandoff(task: string, digest: string): void {
    const content = [
      "<fork_handoff>",
      `Task: ${task}`,
      "Sub-agent completed. Use this as background — do not mention the fork unless asked.",
      "",
      digest,
      "</fork_handoff>",
    ].join("\n");

    this.conversation.push({
      role: "developer",
      content,
    } satisfies ResponseInputItem);
    this.scope.growNaive?.(`fork handoff: ${digest}`);
  }

  /**
   * Out-of-window context (pinned facts + rolling summary) as one developer
   * message, structured with XML sections. Placed LAST in the input — after the
   * stable conversation prefix — so that a `/remember` or a re-summarization
   * changes only the tail and never invalidates the cached prefix above it.
   */
  private contextBlock(): ResponseInputItem[] {
    return buildContextBlock({
      facts: this.scope.facts,
      summary: this.scope.summary,
    });
  }

  private buildRequestParams(options: TurnOptions, forbidTools = false) {
    return {
      model: MODEL,
      input: [...this.conversation, ...this.contextBlock()],
      instructions: this.instructions,
      text: options.structured_output
        ? {
            format: zodTextFormat(options.structured_output, "response_schema"),
          }
        : options.json_mode
          ? { format: { type: "json_object" as const } }
          : undefined,
      temperature: options.temperature,
      max_output_tokens: options.max_output_tokens,
      store: false as const,
      tools: forbidTools ? [] : this.tools,
      prompt_cache_key: this.scope.cacheKey,
    };
  }

  /**
   * Fetch one model response, yielding a `delta` event per streamed token and
   * returning the final parsed response. On the non-streaming path (structured
   * output, forks) it yields nothing and just returns the parsed response.
   */
  private async *streamResponse(
    options: TurnOptions,
    forbidTools = false,
  ): AsyncGenerator<TurnEvent, ParsedResponse<unknown>> {
    const params = this.buildRequestParams(options, forbidTools);

    if (options.stream) {
      const stream = this.openai.responses.stream(params);
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "delta", text: event.delta };
        }
      }
      const final = await stream.finalResponse();
      this.scope.addResponseUsage(final.usage);
      return final;
    }

    const response = await this.openai.responses.parse(params);
    this.scope.addResponseUsage(response.usage);
    return response;
  }

  /**
   * Run a single tool call to completion, never throwing: any failure becomes an
   * error string so the caller can always emit a `function_call_output` (the API
   * rejects a transcript with a dangling function_call, and feeding the error
   * back lets the model recover). A `delegate_task` call drains its sub-agent's
   * event stream to `onEvent` and returns the handoff to inject once the round
   * settles.
   */
  private async executeCall(
    call: { name: string; arguments: string },
    onEvent: (event: TurnEvent) => void,
  ): Promise<CallOutcome> {
    try {
      if (call.name === DELEGATE_TASK_NAME) {
        const { title, task } = parseDelegateTaskArgs(call.arguments);
        const digest = await drainEvents(runFork(this.openai, this.scope, task, title), onEvent);
        return { output: digest, handoff: { task, digest } };
      }
      return { output: await executeToolCall(call.name, call.arguments) };
    } catch (error) {
      return {
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Run one full turn for `prompt`: push it, then loop model → tool calls →
   * repeat until the model stops asking for tools, yielding a stream of
   * {@link TurnEvent}s throughout and a final `answer` event. The events are
   * plain data, so any UI (TUI, web) consumes the same stream via `for await`.
   */
  async *run(
    prompt: string,
    options: TurnOptions = DEFAULT_TURN_OPTIONS,
  ): AsyncGenerator<TurnEvent, void> {
    this.pushUserMessage(prompt);

    const naiveInput = this.scope.snapshotNaiveInput?.(estimateTokens(this.instructions)) ?? 0;

    let response = yield* this.streamResponse(options);
    let steps = 0;

    while (hasFunctionCalls(response.output)) {
      const replay = toReplayInputItems(response.output);
      this.conversation.push(...replay);
      this.scope.growNaive?.(renderItemsText(replay));

      const calls = getFunctionCalls(response.output);

      // The model can request several tools in one response — they're
      // independent, so launch them all at once and let them run concurrently
      // instead of awaiting each in turn. Delegated forks push their sub-agent's
      // tool events into `subEvents`; each call keeps it open until it settles.
      const subEvents = new EventQueue<TurnEvent>();
      const inflight = calls.map((call) => {
        subEvents.open();
        const outcome = this.executeCall(call, (event) => subEvents.push(event)).finally(() =>
          subEvents.close(),
        );
        return { call, outcome };
      });

      // Surface each launched call as a step in the thinking trace — a concise
      // title for a delegation, or the tool's label plus a per-call detail
      // (query, city) drawn from its structured arguments.
      for (const { call } of inflight) {
        yield call.name === DELEGATE_TASK_NAME
          ? { type: "status", text: `Delegating: ${describeTask(call.arguments)}` }
          : {
              type: "tool",
              name: call.name,
              detail: describeToolCall(call.name, call.arguments),
            };
      }

      // Stream sub-agent tool events live as the forks run, interleaving events
      // from multiple concurrent forks; ends once every call has settled.
      yield* subEvents.drain();

      // Collect the outputs in request order. Handoff injection and transcript
      // appends run here, off the concurrent path, so they can't race on
      // `this.conversation`.
      for (const { call, outcome } of inflight) {
        const { output, handoff } = await outcome;
        if (handoff) {
          this.injectForkHandoff(handoff.task, handoff.digest);
        }
        this.conversation.push({
          type: "function_call_output",
          call_id: call.call_id,
          output,
        });
        this.scope.growNaive?.(`tool result: ${output}`);
      }

      // On the final allowed round, re-request with tools disabled so the model
      // must produce an answer instead of looping on another tool call.
      steps += 1;
      response = yield* this.streamResponse(options, steps >= MAX_TOOL_STEPS);
    }

    const finalItems = toResponseInputItems(response.output);
    this.conversation.push(...finalItems);
    this.scope.growNaive?.(renderItemsText(finalItems));

    this.scope.finishTurn?.(naiveInput);
    await this.maintainWindow();

    yield { type: "answer", content: formatResponse(response, options) };
  }

  /**
   * Deterministic truncation: keep only the last `keepLastTurns` turns in the
   * window and fold everything older into the rolling summary (out-of-window
   * state). Runs once per turn, after the answer is committed.
   */
  private async maintainWindow(): Promise<void> {
    if (countUserTurns(this.conversation) <= this.keepLastTurns) {
      return;
    }

    const { evicted, kept } = splitAtLastTurns(this.conversation, this.keepLastTurns);
    if (!evicted.length) {
      return;
    }

    const { text, usage } = await summarize(this.openai, this.scope.summary, evicted);
    this.scope.addSummarizerUsage(usage);
    this.scope.setSummary(text);
    this.conversation = kept;
  }
}
