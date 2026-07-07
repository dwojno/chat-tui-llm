import { DEFAULT_TURN_OPTIONS } from '../conversation/options'
import { ResponseSchema } from '../conversation/schemas'
import type { Command } from './types'

const PREFIX = '/structured '

/**
 * `/structured <prompt>` — run a turn whose reply is validated against
 * {@link ResponseSchema} (answer + sources) instead of free-form text.
 */
export const structuredCommand: Command = {
  name: 'structured',
  matches: (input) => input.startsWith(PREFIX),
  run: (input, { temperature }) => ({
    kind: 'turn',
    content: input.slice(PREFIX.length).trim(),
    options: {
      ...DEFAULT_TURN_OPTIONS,
      temperature,
      structured_output: ResponseSchema,
    },
  }),
}
