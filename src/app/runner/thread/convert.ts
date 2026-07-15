import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from "openai/resources/responses/responses.mjs";
import type { AgentEvent } from "./events";

export const TOOL_ERROR_PREFIX = "Error: ";

export function toolCallToEvent(
  call: ResponseFunctionToolCall,
): Extract<AgentEvent, { type: "tool_call" }> {
  return { type: "tool_call", id: call.call_id, name: call.name, args: parseArgs(call.arguments) };
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
    )
    .join("");
}

export function eventsToInputItems(events: readonly AgentEvent[]): ResponseInputItem[] {
  return events.flatMap((event): ResponseInputItem[] => {
    switch (event.type) {
      case "user_message":
      case "human_response":
        return [{ role: "user", content: event.content }];
      case "assistant_answer":
        return [{ role: "assistant", content: event.content }];
      case "summary":
        return [{ role: "developer", content: event.content }];
      case "clarification_request":
        return [{ role: "assistant", content: event.question }];
      case "tool_call":
        return [
          {
            type: "function_call",
            call_id: event.id,
            name: event.name,
            arguments: JSON.stringify(event.args),
          },
        ];
      case "tool_result":
        return [{ type: "function_call_output", call_id: event.id, output: event.output }];
      case "error":
        return [
          {
            type: "function_call_output",
            call_id: event.id,
            output: `${TOOL_ERROR_PREFIX}${event.message}`,
          },
        ];
      case "approval_request":
      case "approval_response":
        return [];
    }
  });
}

export function inputItemsToEvents(items: readonly ResponseInputItem[]): AgentEvent[] {
  return items.flatMap((item): AgentEvent[] => {
    if ("role" in item && "content" in item) {
      const content = contentToText(item.content);
      if (item.role === "assistant") return [{ type: "assistant_answer", content }];
      if (item.role === "user") return [{ type: "user_message", content }];
      return [];
    }
    if ("role" in item) return [];
    if (item.type === "function_call") {
      return [
        { type: "tool_call", id: item.call_id, name: item.name, args: parseArgs(item.arguments) },
      ];
    }
    if (item.type === "function_call_output") {
      const output = typeof item.output === "string" ? item.output : "";
      return [{ type: "tool_result", id: item.call_id, name: "", output }];
    }
    return [];
  });
}
