import { describe, expect, it, vi } from "vitest";
import { askUserTool } from "@/app/tools/ask-user";
import { EventBus } from "@chat/agent/events/bus";
import {
  CLARIFICATION_UNANSWERED_OUTPUT,
  type ClarificationRequest,
} from "@chat/agent/humanLayer/clarification";
import type { ToolRunContext } from "@chat/agent/conversation/turn";

function ctxWith(answer: string | null) {
  const requestClarification = vi.fn(async (_request: ClarificationRequest) => ({ answer }));
  const ctx = { bus: new EventBus(), requestClarification } as unknown as ToolRunContext;
  return { ctx, requestClarification };
}

describe("askUserTool", () => {
  it("returns the user's answer when the gate resolves one", async () => {
    const { ctx, requestClarification } = ctxWith("prod");

    const result = await askUserTool.execute(
      { question: "Which environment?", reason: null, options: ["staging", "prod"] },
      ctx,
    );

    expect(requestClarification).toHaveBeenCalledWith({
      question: "Which environment?",
      options: ["staging", "prod"],
    });
    expect(result).toContain("prod");
  });

  it("falls back to best-judgement guidance when the user gives no answer", async () => {
    const { ctx } = ctxWith(null);

    const result = await askUserTool.execute(
      { question: "Which environment?", reason: null, options: null },
      ctx,
    );

    expect(result).toBe(CLARIFICATION_UNANSWERED_OUTPUT);
  });

  it("proceeds on its own when no human is available to answer", async () => {
    const result = await askUserTool.execute({
      question: "Which environment?",
      reason: null,
      options: null,
    });

    expect(result).toContain("best judgement");
  });

  it("summarizes a call to its question", () => {
    expect(
      askUserTool.summarize?.({ question: "Which environment?", reason: null, options: null }),
    ).toBe("Which environment?");
  });
});
