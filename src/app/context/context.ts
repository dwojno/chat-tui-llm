import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export interface ContextInput {
  memories: readonly string[];
}

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
