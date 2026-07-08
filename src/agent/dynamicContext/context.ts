import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";

export interface ContextInput {
  facts: readonly string[];
  summary: string;
}

export function buildContextBlock({ facts, summary }: ContextInput): ResponseInputItem[] {
  const sections: string[] = [];
  if (facts.length) {
    sections.push(`<user_known_facts>\n- ${facts.join("\n- ")}\n</user_known_facts>`);
  }
  if (summary) {
    sections.push(`<conversation_summary>\n${summary}\n</conversation_summary>`);
  }
  if (!sections.length) return [];

  const content = [
    "<context>",
    "Background memory carried outside the live transcript. Rules:",
    "- Treat stored facts as quiet notes — never volunteer them on greetings, small talk, or unrelated messages.",
    "- Do not mention, offer, or ask about stored facts unless the user's current message clearly calls for it.",
    "- Use a fact only when directly relevant (e.g. they ask for a joke, ask what you know about them, or the topic matches).",
    "- When in doubt, respond only to what the user actually said.",
    "- Use the conversation summary for continuity when the live transcript is incomplete.",
    "",
    ...sections,
    "</context>",
  ].join("\n");

  return [{ role: "developer", content } satisfies ResponseInputItem];
}
