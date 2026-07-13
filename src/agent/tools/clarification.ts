export interface ClarificationRequest {
  question: string;
  reason?: string | undefined;
  options?: readonly string[] | undefined;
}

export interface ClarificationResponse {
  answer: string | null;
}

export type ClarificationGate = (request: ClarificationRequest) => Promise<ClarificationResponse>;

export const CLARIFICATION_UNANSWERED_OUTPUT =
  "The user did not provide an answer. Proceed using your best judgement and " +
  "state any assumptions you make.";
