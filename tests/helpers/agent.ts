import type { OpenAI } from "openai";
import { Agent, type AgentDeps } from "../../src/agent/agent";
import { EventBus } from "../../src/agent/events/bus";
import { Session } from "../../src/integration/session";
import type { Store } from "../../src/store";

export function testAgent(openai: OpenAI, extra: Partial<AgentDeps> = {}): Agent {
  return new Agent({
    openai,
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
  const agent = testAgent(openai, opts.tools ? { tools: opts.tools } : {});
  const session = await Session.create(agent, openai, store, opts.keepLastTurns ?? 4, bus);
  return { session, bus };
}
