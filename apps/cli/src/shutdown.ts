import type { Session } from "@/session/session";
import { formatRestoreHint } from "@/session/switch";
import type { Store } from "@/backend";

export async function buildExitMessage(store: Store, session: Session): Promise<string> {
  await store.conversation.pruneEmpty();
  const report = await session.report();
  const active = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
  const hint = active ? `\n${formatRestoreHint(store.conversationId)}` : "";
  return `\n${report}${hint}\n`;
}
