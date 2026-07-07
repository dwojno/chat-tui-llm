import type { OpenAI } from "openai";
import { FORK_INSTRUCTIONS } from "../config";
import type { TurnEvent } from "./events";
import { DEFAULT_TURN_OPTIONS } from "./options";
import { ConversationService } from "./service";
import { EphemeralScope, type ConversationScope } from "./scope";
import { compressHandoff } from "./handoff";
import { forkTools } from "../tools";

const FORK_KEEP_LAST_TURNS = 2;

function buildForkBrief(summary: string, facts: readonly string[], task: string): string {
  const parts = [
    summary ? `Parent context:\n${summary}` : "",
    facts.length ? `Known facts:\n- ${facts.join("\n- ")}` : "",
    `Your task:\n${task}`,
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Run an ephemeral child conversation for `task`: a generator that yields the
 * sub-agent's tool/status activity (tagged with the short `label` via the
 * `fork` field, so the trace stays concise) as it happens, then returns a
 * compressed digest suitable for injection into the main thread. The child's
 * answer tokens stay internal — the result comes back as the digest, folded in
 * through the handoff.
 */
export async function* runFork(
  openai: OpenAI,
  parent: ConversationScope,
  task: string,
  label: string,
): AsyncGenerator<TurnEvent, string> {
  const childScope = new EphemeralScope(parent);
  const child = new ConversationService(openai, childScope, {
    instructions: FORK_INSTRUCTIONS,
    tools: forkTools,
    keepLastTurns: FORK_KEEP_LAST_TURNS,
  });

  const brief = buildForkBrief(parent.summary, parent.facts, task);
  for await (const event of child.run(brief, {
    ...DEFAULT_TURN_OPTIONS,
    stream: false,
  })) {
    if (event.type === "tool" || event.type === "status") {
      yield { ...event, fork: label };
    }
  }

  const { text, usage } = await compressHandoff(openai, child.items, childScope.summary);
  parent.addSummarizerUsage(usage);
  return text;
}
