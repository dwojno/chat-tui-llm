import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export interface ContextInput {
  memories: readonly string[];
}

const SUMMARY_OPEN = "<conversation_summary>";
const SUMMARY_CLOSE = "</conversation_summary>";

export function extractConversationSummary(messages: readonly ResponseInputItem[]): string {
  for (const item of messages) {
    if (!("role" in item) || item.role !== "developer") continue;
    const content = "content" in item ? item.content : undefined;
    if (typeof content !== "string") continue;
    const open = content.indexOf(SUMMARY_OPEN);
    if (open === -1) continue;
    const close = content.indexOf(SUMMARY_CLOSE, open);
    if (close === -1) continue;
    return content.slice(open + SUMMARY_OPEN.length, close).trim();
  }
  return "";
}

/**
 * Assign each memory a stable per-turn key (`M1`, `M2`, …) over the ordered
 * list. `Session` fetches memories fresh per turn, so these indices are stable
 * within a turn — the orchestrator can reference `M2` and `delegate_task` can
 * resolve `relevantMemoryKeys: ["M2"]` back to the same text.
 */
export function keyMemories(memories: readonly string[]): { key: string; text: string }[] {
  return memories.map((text, index) => ({ key: `M${index + 1}`, text }));
}

export function buildContextBlock({ memories }: ContextInput): ResponseInputItem[] {
  if (!memories.length) return [];

  const lines = keyMemories(memories).map((m) => `${m.key}: ${m.text}`);
  const content = [
    "<context>",
    "Background memory carried outside the live transcript. Rules:",
    "- Treat stored memories as quiet notes — never volunteer them on greetings, small talk, or unrelated messages.",
    "- Do not mention, offer, or ask about stored memories unless the user's current message clearly calls for it.",
    "- Use a memory only when directly relevant (e.g. they ask for a joke, ask what you know about them, or the topic matches).",
    "- When in doubt, respond only to what the user actually said.",
    "- Use the conversation summary for continuity when the live transcript is incomplete.",
    "- Each memory is labelled M1, M2, … — when delegating a sub-task, pass only the keys it needs.",
    "",
    `<user_known_memories>\n${lines.join("\n")}\n</user_known_memories>`,
    "</context>",
  ].join("\n");

  return [{ role: "developer", content } satisfies ResponseInputItem];
}
