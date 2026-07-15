import { ORCHESTRATOR_MODEL } from "@/app/config";
import type { Command } from "./types";
import { applyContextSwitch } from "@/app/session/switch";
import type { PickerItem } from "@/ui/input/picker-keys";

const COMMAND = "/profile";

function profileMeta(model: string | null, sourceCount: number, memoryCount: number): string {
  const effectiveModel = model ?? ORCHESTRATOR_MODEL;
  if (sourceCount > 0) return `${sourceCount} sources`;
  if (memoryCount > 0) return `${memoryCount} memories`;
  return effectiveModel;
}

export const profileCommand: Command = {
  name: "profile",
  completion: COMMAND,
  hint: "switch or create a profile",
  matches: (input) => input.trim() === COMMAND,
  run: async (input, { session, chat }) => {
    chat.push({ role: "user", content: input.trim() });

    const store = session.store;
    const profiles = await store.profile.query().execute();
    const items: PickerItem[] = await Promise.all(
      profiles.map(async (entry) => {
        const [sources, memories] = await Promise.all([
          store.sources.query().forProfile(entry.id).execute(),
          store.memory.query().forProfile(entry.id).execute(),
        ]);
        return {
          id: entry.id,
          label: entry.name,
          meta: profileMeta(entry.model, sources.length, memories.length),
          current: entry.id === store.profileId,
        };
      }),
    );

    const choice = await chat.pickEntity({
      title: "Select Profile",
      items,
      createLabel: "Create new profile",
    });

    if (choice === null) return { kind: "handled" };

    if (choice === "create") {
      const name = await chat.promptInModal({
        title: "Profile name",
        placeholder: "e.g. chat-cli",
      });
      if (!name) return { kind: "handled" };
      const created = await store.profile.create(name);
      await store.profile.switchTo(created.id);
    } else if (choice !== store.profileId) {
      await store.profile.switchTo(choice);
    } else {
      return { kind: "handled" };
    }

    await applyContextSwitch(chat, session, store);
    chat.setConversationId(store.conversationId);
    const profile = await store.profile.query().byId(store.profileId).executeAndTakeFirst();
    chat.push({
      role: "assistant",
      content: `Switched to profile "${profile?.name ?? store.profileId}" · conversation "New chat"`,
    });
    return { kind: "handled" };
  },
};
