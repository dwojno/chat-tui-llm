import { containsTerm, defineScorer, isAbsent, notApplicable } from './common'

/** Fraction of forbidden substrings correctly absent (catches leaked facts). */
export const avoidsForbidden = defineScorer(
  'avoids-forbidden',
  'answer omits every forbidden substring (no leaked facts)',
  ({ output, expected }) => {
    const forbidden = expected?.mustOmit
    if (isAbsent(forbidden) || forbidden.length === 0) return notApplicable
    const leaked = forbidden.filter((term) => containsTerm(output.text, term))
    return {
      score: (forbidden.length - leaked.length) / forbidden.length,
      metadata: leaked.length ? { leaked } : { clean: forbidden },
    }
  },
)
