import type { OpenAI } from 'openai'
import { FORK_INSTRUCTIONS } from '../config'
import { DEFAULT_TURN_OPTIONS } from './options'
import { ConversationService } from './service'
import { EphemeralScope, type ConversationScope } from './scope'
import { compressHandoff } from './handoff'
import { forkTools } from '../tools'

const FORK_KEEP_LAST_TURNS = 2

function buildForkBrief(
  summary: string,
  facts: readonly string[],
  task: string,
): string {
  const parts = [
    summary ? `Parent context:\n${summary}` : '',
    facts.length ? `Known facts:\n- ${facts.join('\n- ')}` : '',
    `Your task:\n${task}`,
  ].filter(Boolean)
  return parts.join('\n\n')
}

/**
 * Run an ephemeral child conversation for `task`, compress it, and return a
 * digest suitable for injection into the main thread.
 */
export async function runFork(
  openai: OpenAI,
  parent: ConversationScope,
  task: string,
): Promise<string> {
  const childScope = new EphemeralScope(parent)
  const child = new ConversationService(openai, childScope, {
    instructions: FORK_INSTRUCTIONS,
    tools: forkTools,
    keepLastTurns: FORK_KEEP_LAST_TURNS,
  })

  child.pushUserMessage(buildForkBrief(parent.summary, parent.facts, task))
  await child.completeTurn({ ...DEFAULT_TURN_OPTIONS, stream: false })

  const { text, usage } = await compressHandoff(openai, child.items, childScope.summary)
  parent.addSummarizerUsage(usage)
  return text
}
