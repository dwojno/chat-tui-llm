import { z } from 'zod'

export const DELEGATE_TASK_NAME = 'delegate_task' as const

const parameters = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      'A short label (a few words, e.g. "Compare SSR vs SSG") describing the ' +
        'sub-task — shown to the user. Not the full brief.',
    ),
  task: z
    .string()
    .min(1)
    .describe('Self-contained sub-task brief for the sub-agent to complete'),
})

export const delegateTaskDefinition = {
  name: DELEGATE_TASK_NAME,
  label: 'Delegating to a sub-agent',
  description:
    'Delegate a self-contained sub-task to a focused sub-agent. Provide a ' +
    'short `title` for display and a self-contained `task` brief. Use for ' +
    'multi-step research, exploratory work, or tasks that need several tool ' +
    'calls. Call it several times in one response to fan out independent ' +
    'sub-tasks to parallel sub-agents. Do not use for simple one-shot lookups ' +
    '(e.g. a single weather check).',
  parameters,
}

export function parseDelegateTaskArgs(
  argsJson: string,
): z.infer<typeof parameters> {
  return parameters.parse(JSON.parse(argsJson))
}

export function toDelegateTaskOpenAITool() {
  return {
    type: 'function' as const,
    name: delegateTaskDefinition.name,
    label: delegateTaskDefinition.label,
    parameters: delegateTaskDefinition.parameters.toJSONSchema(),
    strict: true,
    description: delegateTaskDefinition.description,
  }
}
