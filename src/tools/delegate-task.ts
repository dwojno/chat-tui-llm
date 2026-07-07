import { z } from 'zod'

export const DELEGATE_TASK_NAME = 'delegate_task' as const

const parameters = z.object({
  task: z
    .string()
    .min(1)
    .describe('Self-contained sub-task for a sub-agent to complete'),
})

export const delegateTaskDefinition = {
  name: DELEGATE_TASK_NAME,
  description:
    'Delegate a self-contained sub-task to a focused sub-agent. Use for ' +
    'multi-step research, exploratory work, or tasks that need several tool ' +
    'calls. Do not use for simple one-shot lookups (e.g. a single weather check).',
  parameters,
}

export function parseDelegateTaskArgs(argsJson: string): z.infer<typeof parameters> {
  return parameters.parse(JSON.parse(argsJson))
}

export function toDelegateTaskOpenAITool() {
  return {
    type: 'function' as const,
    name: delegateTaskDefinition.name,
    parameters: delegateTaskDefinition.parameters.toJSONSchema(),
    strict: true,
    description: delegateTaskDefinition.description,
  }
}
