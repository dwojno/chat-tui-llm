import type { OpenAI } from "openai";
import { Agent, type AgentDeps } from "@/agent/agent";
import { EventBus } from "@/agent/events/bus";
import { Session } from "@/app/session/session";
import { Model } from "@/platform/model";
import type { Store } from "@/store";

export function testModel(openai: OpenAI): Model {
  return Model.fromOpenAI(openai);
}

export function testAgent(openai: OpenAI, extra: Partial<AgentDeps> = {}): Agent {
  return new Agent({
    model: testModel(openai),
    temperature: 0.7,
    cacheKey: "chat-cli:test",
    instructions: "system",
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
