import { DEFAULT_TURN_OPTIONS } from '../conversation/options'
import type { Command } from './types'

const PREFIX = '/json '

/**
 * `/json <prompt>` — run a turn in the model's JSON output mode. We also append
 * an explicit instruction because JSON mode requires the word "JSON" somewhere
 * in the prompt.
 */
export const jsonCommand: Command = {
  name: 'json',
  matches: (input) => input.startsWith(PREFIX),
  run: (input, { temperature }) => {
    const prompt = input.slice(PREFIX.length).trim()
    return {
      kind: 'turn',
      content: `${prompt}\n\nRespond in JSON format.`,
      options: {
        ...DEFAULT_TURN_OPTIONS,
        temperature,
        json_mode: true,
      },
    }
  },
}
