export const MODEL = 'gpt-4o-mini'

export const SYSTEM_INSTRUCTIONS =
  'You are a helpful assistant that can answer questions and help with tasks. ' +
  'Return messages in markdown format.'

/** Completed user turns before triggering a manual `/responses/compact` call. */
export const COMPACT_AFTER_TURNS = 3
