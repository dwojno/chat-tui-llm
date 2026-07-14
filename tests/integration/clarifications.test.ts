import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type {
  ClarificationRequest,
  ClarificationResponse,
} from "../../src/agent/humanLayer/clarification";
import type { ToolDefinition } from "../../src/agent/tools/types";
import { askUserTool } from "../../src/tools/ask-user";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { createMemoryStore, createMockOpenAI } from "../helpers/mock-openai";
import { testSession } from "../helpers/agent";

const askUser = askUserTool as ToolDefinition<z.ZodType>;

describe("Session HITL clarifications", () => {
  it("routes an ask_user call to the clarification handler, then continues the turn", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      {
        calls: [
          {
            name: "ask_user",
            arguments: {
              question: "Which environment?",
              reason: null,
              options: ["staging", "prod"],
            },
          },
        ],
      },
      { text: "Deploying to prod." },
    ]);
    const { session } = await testSession(mock.client, store, { tools: [askUser] });

    const answer = vi.fn(
      async (_request: ClarificationRequest): Promise<ClarificationResponse> => ({
        answer: "prod",
      }),
    );
    session.setClarificationHandler(answer);

    await session.runTurn("deploy the app", { ...DEFAULT_TURN_OPTIONS, stream: false });

    expect(session.hasClarificationHandler).toBe(true);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Which environment?", options: ["staging", "prod"] }),
    );
  });

  it("does not gate when no clarification handler is set", async () => {
    const store = await createMemoryStore();
    const mock = createMockOpenAI([
      {
        calls: [
          {
            name: "ask_user",
            arguments: { question: "Which environment?", reason: null, options: null },
          },
        ],
      },
      { text: "done" },
    ]);
    const { session } = await testSession(mock.client, store, { tools: [askUser] });

    await session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false });

    expect(session.hasClarificationHandler).toBe(false);
  });
});
