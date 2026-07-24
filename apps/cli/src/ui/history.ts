import type { AgentEvent } from "@chat/agent";
import { toolStepLabel } from "./labels";
import type { Message, Step } from "./types";

export function messagesFromTranscript(events: readonly AgentEvent[]): Message[] {
  const messages: Message[] = [];
  let pendingSteps: Step[] = [];

  const flushAssistant = (content: string): void => {
    messages.push({
      role: "assistant",
      content,
      ...(pendingSteps.length ? { steps: pendingSteps } : {}),
    });
    pendingSteps = [];
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message":
      case "human_response":
        messages.push({ role: "user", content: event.content });
        break;
      case "assistant_answer":
        flushAssistant(event.content);
        break;
      case "clarification_request":
        flushAssistant(event.question);
        break;
      case "tool_call":
        pendingSteps.push({ label: toolStepLabel(event.name) });
        break;
      default:
        break;
    }
  }

  if (pendingSteps.length) {
    messages.push({ role: "assistant", content: "", steps: pendingSteps });
  }

  return messages;
}
