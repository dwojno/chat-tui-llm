export const ORCHESTRATOR_MODEL = "gpt-5.6-luna";
export const FORK_MODEL = "gpt-4.1-nano";
export const SUMMARIZER_MODEL = "gpt-4.1-nano";
export const HANDOFF_MODEL = "gpt-4.1-nano";
export const EVAL_PROBE_MODEL = "gpt-4o-mini";
export const TEMPERATURE = 0.7;
export const MAX_TOOL_STEPS = 8;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const DEFAULT_CACHE_KEY = "chat-cli";

const MODEL_NAMES = {
  ORCHESTRATOR_MODEL: ORCHESTRATOR_MODEL,
  FORK_MODEL: FORK_MODEL,
  SUMMARIZER_MODEL: SUMMARIZER_MODEL,
  HANDOFF_MODEL: HANDOFF_MODEL,
  EVAL_PROBE_MODEL: EVAL_PROBE_MODEL,
} as const;

export type Model = (typeof MODEL_NAMES)[keyof typeof MODEL_NAMES];
