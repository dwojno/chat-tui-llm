import type { OpenAI } from "openai";
import { Agent, type AgentDeps } from "@chat/agent/agent";
import { EventBus } from "@chat/agent/events/bus";
import { Session } from "@/session/session";
import { Model } from "@chat/platform/model";
import { traceToolExecution } from "@chat/platform/telemetry";
import type { Store } from "@/backend";

function testModel(openai: OpenAI): Model {
  return Model.fromOpenAI(openai);
}

export function testAgent(openai: OpenAI, extra: Partial<AgentDeps> = {}): Agent {
  return new Agent({
    model: testModel(openai),
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: "system",
    traceToolExecution,
    ...extra,
  });
}

export async function testSession(
  openai: OpenAI,
  store: Store,
  opts: { keepLastTurns?: number; tools?: AgentDeps["tools"] } = {},
): Promise<{ session: Session; bus: EventBus }> {
  const bus = new EventBus();
  const model = testModel(openai);
  const agent = testAgent(openai, opts.tools ? { tools: opts.tools } : {});
  const session = await Session.create(agent, model, store, opts.keepLastTurns ?? 4, bus);
  return { session, bus };
}
