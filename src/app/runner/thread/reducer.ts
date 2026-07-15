import type { ResponseInputItem } from "openai/resources/responses/responses.mjs";
import { keyMemories } from "@/app/context/context";
import type { AgentEvent } from "./events";
import { toYaml } from "./yaml";

export interface ReduceInput {
  events: readonly AgentEvent[];
  memories?: readonly string[];
}

const MEMORY_RULES = [
  "Background memory carried outside the live transcript. Rules:",
  "- Treat stored memories as quiet notes — never volunteer them on greetings, small talk, or unrelated messages.",
  "- Do not mention, offer, or ask about stored memories unless the user's current message clearly calls for it.",
  "- Use a memory only when directly relevant (e.g. they ask for a joke, ask what you know about them, or the topic matches).",
  "- When in doubt, respond only to what the user actually said.",
  "- Use the conversation summary for continuity when the live transcript is incomplete.",
  "- Each memory is labelled M1, M2, … — when delegating a sub-task, pass only the keys it needs.",
];

const NEXT_STEP =
  "Based on the events above, choose the next step: call one or more tools, ask the user " +
  "for clarification (request_more_information), or give the final answer — either as a " +
  "normal reply or via done_for_now for a structured/sourced answer.";

function tagBlock(tag: string, body: string): string {
  return `<${tag}>\n${body}\n</${tag}>`;
}

function toolCallBody(name: string, args: unknown): string {
  return args && typeof args === "object" && !Array.isArray(args)
    ? toYaml({ intent: name, ...(args as Record<string, unknown>) })
    : toYaml({ intent: name, args });
}

export function eventToPrompt(event: AgentEvent): string | null {
  switch (event.type) {
    case "approval_request":
    case "approval_response":
    case "scratchpad":
      return null;
    case "summary":
      return tagBlock("conversation_summary", event.content);
    case "user_message":
    case "human_response":
    case "assistant_answer":
      return tagBlock(event.type, event.content);
    case "tool_call":
      return tagBlock(event.name, toolCallBody(event.name, event.args));
    case "tool_result":
      return tagBlock(`${event.name}_result`, event.output);
    case "error":
      return tagBlock("error", toYaml({ tool: event.name, error: event.message }));
    case "clarification_request":
      return tagBlock(
        "clarification_request",
        toYaml({
          question: event.question,
          ...(event.options?.length ? { options: event.options } : {}),
        }),
      );
  }
}

function pruneResolvedErrors(events: readonly AgentEvent[]): AgentEvent[] {
  const resolved = new Set<string>();
  events.forEach((event, index) => {
    if (event.type !== "error") return;
    const healed = events
      .slice(index + 1)
      .some((later) => later.type === "tool_result" && later.name === event.name);
    if (healed) resolved.add(event.id);
  });
  return events.filter((event) => event.type !== "error" || !resolved.has(event.id));
}

export function threadToPrompt(events: readonly AgentEvent[]): string {
  return pruneResolvedErrors(events)
    .map(eventToPrompt)
    .filter((block): block is string => block !== null)
    .join("\n\n");
}

export function deriveScratchpad(
  events: readonly AgentEvent[],
): { section: string; content: string }[] {
  const sections = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "scratchpad") continue;
    for (const { section, content } of event.ops) {
      if (content === null) sections.delete(section);
      else sections.set(section, content);
    }
  }
  return [...sections].map(([section, content]) => ({ section, content }));
}

function scratchpadBlock(sections: { section: string; content: string }[]): string {
  return tagBlock("scratchpad", sections.map((s) => tagBlock(s.section, s.content)).join("\n"));
}

function memoriesBlock(memories: readonly string[]): string {
  const lines = keyMemories(memories).map((m) => `${m.key}: ${m.text}`);
  return [
    ...MEMORY_RULES,
    "",
    `<user_known_memories>\n${lines.join("\n")}\n</user_known_memories>`,
  ].join("\n");
}

export function buildMessage({ events, memories = [] }: ReduceInput): ResponseInputItem[] {
  const scratchpad = deriveScratchpad(events);
  const parts = [
    `<events>\n${threadToPrompt(events)}\n</events>`,
    memories.length ? `<context>\n${memoriesBlock(memories)}\n</context>` : "",
    scratchpad.length ? scratchpadBlock(scratchpad) : "",
    `<next_step>\n${NEXT_STEP}\n</next_step>`,
  ].filter(Boolean);

  return [{ role: "user", content: parts.join("\n\n") } satisfies ResponseInputItem];
}

export function deriveControl(events: readonly AgentEvent[]): { consecutiveErrors: number } {
  let consecutiveErrors = 0;
  for (const event of events) {
    if (
      event.type === "tool_result" ||
      event.type === "user_message" ||
      event.type === "human_response"
    ) {
      consecutiveErrors = 0;
    } else if (event.type === "error") {
      consecutiveErrors += 1;
    }
  }
  return { consecutiveErrors };
}
