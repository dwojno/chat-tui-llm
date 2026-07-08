import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { ZodType } from "zod";
import { MODEL } from "../../src/agent/config";
import { SYSTEM_INSTRUCTIONS } from "../../src/agent/prompts";
import { buildContextBlock } from "../../src/agent/dynamicContext/context";
import { summaryDeveloperMessage } from "../../src/store/conversation/query";
import { getFunctionCalls } from "../../src/agent/conversation/items";
import { forkTools, mainTools } from "../../src/agent/tools";
import { openai } from "./client";

type OpenAITool = (typeof mainTools)[number] | (typeof forkTools)[number];

/** A tool call the model emitted, with arguments parsed for convenience. */
export interface ProbeToolCall {
  name: string;
  arguments: string;
  /** `arguments` parsed to an object (`{}` if it failed to parse). */
  args: Record<string, unknown>;
}

/** The observable surface of one model turn — all a scorer may inspect. */
export interface ProbeResult {
  /** Plain-text output (`output_text`), trimmed. */
  text: string;
  /** Every `function_call` item the model emitted this turn. */
  toolCalls: ProbeToolCall[];
  /** Structured `output_parsed`, when a structured/JSON format was requested. */
  parsed: unknown;
  usage: ResponseUsage | undefined;
}

/** What to send the model for one probe. */
export interface ProbeSpec {
  /** The user message. */
  prompt: string;
  /** Defaults to the production system prompt. */
  instructions?: string;
  /** Defaults to the production tool set (weather + delegate_task). */
  tools?: OpenAITool[];
  /** Out-of-window memory injected as the trailing developer message. */
  context?: { facts?: string[]; summary?: string };
  /** Structured-output schema (mirrors the `/structured` command). */
  structuredOutput?: ZodType;
  temperature?: number;
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Run exactly ONE model turn against the given prompt/tools and return its
 * observable surface. Unlike the AgentService, this does NOT execute
 * tools or run the loop — it captures the model's *first* decision (which tool
 * it chose, what it said), which is exactly what a routing eval grades. Tools
 * are still passed so the model has the real menu of choices.
 */
export async function probePrompt(spec: ProbeSpec): Promise<ProbeResult> {
  const summary = spec.context?.summary ?? "";
  const prefix = summary ? [summaryDeveloperMessage(summary)] : [];
  const contextItems = buildContextBlock({
    facts: spec.context?.facts ?? [],
  });

  const response = await openai().responses.parse({
    model: MODEL,
    input: [...prefix, { role: "user", content: spec.prompt }, ...contextItems],
    instructions: spec.instructions ?? SYSTEM_INSTRUCTIONS,
    text: spec.structuredOutput
      ? { format: zodTextFormat(spec.structuredOutput, "response_schema") }
      : undefined,
    temperature: spec.temperature ?? 0,
    max_output_tokens: 1000,
    store: false,
    tools: spec.tools ?? mainTools,
  });

  const toolCalls: ProbeToolCall[] = getFunctionCalls(response.output).map((call) => ({
    name: call.name,
    arguments: call.arguments,
    args: parseArgs(call.arguments),
  }));

  return {
    text: response.output_text.trim(),
    toolCalls,
    parsed: response.output_parsed,
    usage: response.usage,
  };
}
