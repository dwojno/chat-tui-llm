import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export interface ContextInput {
  facts: readonly string[];
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

export function buildContextBlock({ facts }: ContextInput): ResponseInputItem[] {
  if (!facts.length) return [];

  const content = [
    "<context>",
    "Background memory carried outside the live transcript. Rules:",
    "- Treat stored facts as quiet notes — never volunteer them on greetings, small talk, or unrelated messages.",
    "- Do not mention, offer, or ask about stored facts unless the user's current message clearly calls for it.",
    "- Use a fact only when directly relevant (e.g. they ask for a joke, ask what you know about them, or the topic matches).",
    "- When in doubt, respond only to what the user actually said.",
    "- Use the conversation summary for continuity when the live transcript is incomplete.",
    "",
    `<user_known_facts>\n- ${facts.join("\n- ")}\n</user_known_facts>`,
    "</context>",
  ].join("\n");

  return [{ role: "developer", content } satisfies ResponseInputItem];
}
