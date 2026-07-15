export type ApprovalOutcome = "approve" | "reject";

export type AgentEvent =
  | { type: "user_message"; content: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; output: string }
  | { type: "error"; id: string; name: string; message: string }
  | { type: "approval_request"; id: string; name: string; reason?: string; risk?: string }
  | { type: "approval_response"; id: string; outcome: ApprovalOutcome }
  | { type: "clarification_request"; question: string; options?: string[] }
  | { type: "human_response"; content: string }
  | { type: "assistant_answer"; content: string; sources?: string[] }
  | { type: "summary"; content: string }
  | { type: "scratchpad"; ops: { section: string; content: string | null }[] };

export type AgentEventType = AgentEvent["type"];
