import type { Command } from "./types";
import { applyContextSwitch } from "../switch";
import type { PickerItem } from "../../ui/input/picker-keys";

const COMMAND = "/conversation";

function formatRelativeTime(timestamp: number | null): string | undefined {
  if (timestamp === null) return undefined;
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const conversationCommand: Command = {
  name: "conversation",
  completion: COMMAND,
  hint: "switch or start a conversation",
  matches: (input) => input.trim() === COMMAND,
  run: async (input, { session, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const store = session.store;
    const profile = await store.profile.query().byId(store.profileId).executeAndTakeFirst();
    const conversations = await store.conversation
      .query()
      .forProfile(store.profileId)
      .orderByLastActivity()
      .execute();
    const items: PickerItem[] = conversations.map((entry) => ({
      id: entry.id,
      label: entry.title,
      meta: formatRelativeTime(entry.lastActivityAt),
      current: entry.id === store.conversationId,
    }));

    const choice = await chat.pickEntity({
      title: "Select Conversation",
      ...(profile !== null ? { subtitle: profile.name } : {}),
      items,
      createLabel: "New conversation",
    });

    if (choice === null) return { kind: "handled" };

    if (choice === "create") {
      const created = await store.conversation.create(store.profileId);
      await store.conversation.switchTo(created.id);
    } else {
      await store.conversation.switchTo(choice);
    }

    await applyContextSwitch(chat, session, store);
    chat.setConversationId(store.conversationId);
    const conv = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
    chat.push({
      role: "assistant",
      content: `Switched to conversation "${conv?.title ?? "New chat"}"`,
    });
    return { kind: "handled" };
  },
};
