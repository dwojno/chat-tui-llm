import { ORCHESTRATOR_MODEL } from "@/app/config";
import type { ChatHandle } from "@/ui/chat";
import type { Session } from "./session";
import type { Store } from "@/store";

export async function applyContextSwitch(
  chat: ChatHandle,
  session: Session,
  store: Store,
): Promise<void> {
  session.rebind(store);

  chat.replaceMessages([]);
  chat.setUsage(await session.getUsageTotals());
  chat.setContext(await buildChatContext(store));
}

export async function buildChatContext(store: Store): Promise<{
  profileLabel: string;
  conversationLabel: string;
  conversationId: string;
}> {
  const profile = await store.profile.query().byId(store.profileId).executeAndTakeFirst();
  const name = profile?.name ?? store.profileId;
  const model = profile?.model ?? ORCHESTRATOR_MODEL;
  const [sources, memories] = await Promise.all([
    store.sources.query().forProfile(store.profileId).execute(),
    store.memory.query().forProfile(store.profileId).execute(),
  ]);
  const conv = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
  const title = conv?.title ?? "New chat";
  const shortId = store.conversationId.slice(0, 8);

  return {
    profileLabel: `${name} (${model} · ${sources.length} sources · ${memories.length} memories)`,
    conversationLabel: `${shortId} · ${title}`,
    conversationId: store.conversationId,
  };
}

export function formatRestoreHint(conversationId: string): string {
  return `Conversation: ${conversationId}\nResume: pnpm start --conversation ${conversationId}`;
}
