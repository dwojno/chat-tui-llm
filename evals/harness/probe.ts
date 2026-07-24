import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses.mjs";
import type { ZodType } from "zod";
import { EVAL_PROBE_MODEL, HANDOFF_MODEL } from "@/app/config";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { buildContextBlock } from "@/app/context/context";
import { getFunctionCalls } from "@chat/agent/conversation/items";
import type { OpenAITool } from "@chat/agent/tools/types";
import { createMainToolSchemas } from "@chat/tools";
import { openai } from "./client";

const mainToolSchemas = createMainToolSchemas(HANDOFF_MODEL);

export interface ProbeToolCall {
  name: string;
  arguments: string;
  args: Record<string, unknown>;
}

export interface ProbeResult {
  text: string;
  toolCalls: ProbeToolCall[];
  parsed: unknown;
  usage: ResponseUsage | undefined;
}

export interface ProbeSpec {
  prompt: string;
  instructions?: string;
  tools?: OpenAITool[];
  context?: { memories?: string[]; summary?: string };
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

export async function probePrompt(spec: ProbeSpec): Promise<ProbeResult> {
  const summary = spec.context?.summary ?? "";
  const prefix: ResponseInputItem[] = summary
    ? [
        {
          role: "developer",
          content: `<conversation_summary>\n${summary}\n</conversation_summary>`,
        },
      ]
    : [];
  const contextItems = buildContextBlock({
    memories: spec.context?.memories ?? [],
  });

  const text = spec.structuredOutput
    ? { format: zodTextFormat(spec.structuredOutput, "response_schema") }
    : undefined;

  const response = await openai().responses.parse({
    model: EVAL_PROBE_MODEL,
    input: [...prefix, { role: "user", content: spec.prompt }, ...contextItems],
    instructions: spec.instructions ?? SYSTEM_INSTRUCTIONS,
    ...(text ? { text } : {}),
    temperature: spec.temperature ?? 0,
    max_output_tokens: 1000,
    store: false,
    tools: spec.tools ?? mainToolSchemas,
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
