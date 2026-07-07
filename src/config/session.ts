/**
 * Number of most-recent user turns kept verbatim in the live context window.
 * Anything older is folded into a rolling summary (see the summarizer) and
 * dropped from the window — this is the deterministic truncation boundary.
 */
export const KEEP_LAST_TURNS = 4

/** Where out-of-window state (summary, pinned facts, usage totals) is persisted. */
export const STATE_FILE = '.chat-state/session.json'
