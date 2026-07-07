/**
 * Configuration barrel. Import from `../config` to get any setting; the split
 * into `model` (LLM identity + prompt) and `session` (window + persistence)
 * groups related knobs without forcing callers to know which file holds what.
 */
export { MODEL, SYSTEM_INSTRUCTIONS } from './model'
export { KEEP_LAST_TURNS, STATE_FILE } from './session'
