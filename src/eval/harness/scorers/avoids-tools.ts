import { defineScorer, isAbsent, notApplicable } from './common'

/**
 * Were the forbidden tools left uncalled? Catches a sub-agent grabbing an
 * irrelevant tool — e.g. get_weather_data on a research task — which the
 * `route` scorer alone misses when the right tool is also called.
 */
export const avoidsTools = defineScorer(
  'avoids-tools',
  'none of the forbidden tools were called',
  ({ output, expected }) => {
    const forbidden = expected?.forbidTools
    if (isAbsent(forbidden)) return notApplicable
    const called = output.toolCalls.map((call) => call.name)
    const hits = forbidden.filter((tool) => called.includes(tool))
    return hits.length === 0
      ? { score: 1 }
      : { score: 0, metadata: { forbidden: hits, called } }
  },
)
