import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AgentService } from "../../src/agent/agent";
import type {
  ClarificationRequest,
  ClarificationResponse,
} from "../../src/agent/tools/clarification";
import type { ToolDefinition } from "../../src/agent/tools/types";
import { askUserTool } from "../../src/integration/tools/ask-user";
import { DEFAULT_TURN_OPTIONS } from "../../src/agent/conversation/options";
import { Session } from "../../src/integration/session";
import { createMemoryStore, createMockOpenAI } from "../helpers/mock-openai";
import { collect } from "../../src/utils/async-gen";

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
    const agent = new AgentService(mock.client, { tools: [askUser] });
    const session = await Session.create(agent, mock.client, store, 4);

    const answer = vi.fn(
      async (_request: ClarificationRequest): Promise<ClarificationResponse> => ({
        answer: "prod",
      }),
    );
    session.setClarificationHandler(answer);

    await collect(session.runTurn("deploy the app", { ...DEFAULT_TURN_OPTIONS, stream: false }));

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
    const agent = new AgentService(mock.client, { tools: [askUser] });
    const session = await Session.create(agent, mock.client, store, 4);

    await collect(session.runTurn("go", { ...DEFAULT_TURN_OPTIONS, stream: false }));

    expect(session.hasClarificationHandler).toBe(false);
  });
});
