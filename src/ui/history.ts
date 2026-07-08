import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { toolStepLabel } from "./labels";
import type { Message, Step } from "./types";

function textOf(content: unknown): string {
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

/**
 * Replay a persisted transcript as chat bubbles. Mirrors the live REPL: one
 * bubble per user/assistant message, with a turn's tool calls folded into the
 * steps of the assistant message that follows them.
 */
export function messagesFromTranscript(items: readonly ResponseInputItem[]): Message[] {
  const messages: Message[] = [];
  let pendingSteps: Step[] = [];

  for (const item of items) {
    if ("role" in item) {
      if (item.role === "user") {
        messages.push({ role: "user", content: textOf(item.content) });
      } else if (item.role === "assistant") {
        messages.push({
          role: "assistant",
          content: textOf(item.content),
          steps: pendingSteps.length ? pendingSteps : undefined,
        });
        pendingSteps = [];
      }
      continue;
    }

    if (item.type === "function_call") {
      pendingSteps.push({ label: toolStepLabel(item.name) });
    }
  }

  if (pendingSteps.length) {
    messages.push({ role: "assistant", content: "", steps: pendingSteps });
  }

  return messages;
}
