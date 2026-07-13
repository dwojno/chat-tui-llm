import { describe, expect, it, vi } from "vitest";
import { askUserTool } from "../../../src/integration/tools/ask-user";
import {
  CLARIFICATION_UNANSWERED_OUTPUT,
  type ClarificationRequest,
} from "../../../src/agent/tools/clarification";
import type { ToolRunContext } from "../../../src/agent/conversation/turn";
import { drain } from "../../../src/utils/async-gen";

function ctxWith(answer: string | null) {
  const requestClarification = vi.fn(async (_request: ClarificationRequest) => ({ answer }));
  return { ctx: { requestClarification } as unknown as ToolRunContext, requestClarification };
}

describe("askUserTool", () => {
  it("returns the user's answer when the gate resolves one", async () => {
    const { ctx, requestClarification } = ctxWith("prod");

    const result = await drain(
      askUserTool.execute(
        { question: "Which environment?", reason: null, options: ["staging", "prod"] },
        ctx,
      ),
    );

    expect(requestClarification).toHaveBeenCalledWith({
      question: "Which environment?",
      options: ["staging", "prod"],
    });
    expect(result).toContain("prod");
  });

  it("falls back to best-judgement guidance when the user gives no answer", async () => {
    const { ctx } = ctxWith(null);

    const result = await drain(
      askUserTool.execute({ question: "Which environment?", reason: null, options: null }, ctx),
    );

    expect(result).toBe(CLARIFICATION_UNANSWERED_OUTPUT);
  });

  it("proceeds on its own when no human is available to answer", async () => {
    const result = await drain(
      askUserTool.execute({ question: "Which environment?", reason: null, options: null }),
    );

    expect(result).toContain("best judgement");
  });

  it("summarizes a call to its question", () => {
    expect(
      askUserTool.summarize?.({ question: "Which environment?", reason: null, options: null }),
    ).toBe("Which environment?");
  });
});
