/**
 * The event vocabulary a turn emits as it runs. Every variant is plain,
 * JSON-serializable data — no functions, no UI types — so the same stream can
 * drive the Ink TUI in-process or be forwarded over the wire (SSE/websocket) to
 * a web client. `ConversationService.run` yields these; each surface maps them
 * to its own rendering.
 */
export type TurnEvent =
  | { type: 'delta'; text: string } // streamed answer token
  | { type: 'tool'; name: string; detail?: string; fork?: string } // a tool call started
  | { type: 'status'; text: string; fork?: string } // e.g. "Delegating: <task>…"
  | { type: 'answer'; content: string } // final formatted answer

// `fork`, when present, names the sub-agent task an event originated in — so a
// UI can nest a delegated sub-agent's tool activity under its delegation step.
