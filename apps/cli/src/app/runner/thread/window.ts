import type { AgentEvent } from "@chat/agent";

export function countUserTurns(events: readonly AgentEvent[]): number {
  return events.filter((event) => event.type === "user_message").length;
}

export function splitAtLastTurns(
  events: readonly AgentEvent[],
  keepTurns: number,
): { evicted: AgentEvent[]; kept: AgentEvent[] } {
  if (keepTurns <= 0) return { evicted: [...events], kept: [] };

  const userIndices = events.flatMap((event, index) =>
    event.type === "user_message" ? [index] : [],
  );

  if (userIndices.length <= keepTurns) {
    return { evicted: [], kept: [...events] };
  }

  const cut = userIndices[userIndices.length - keepTurns];
  return { evicted: events.slice(0, cut), kept: events.slice(cut) };
}
