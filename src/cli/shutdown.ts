import type { Session } from "../integration/session";
import { formatRestoreHint } from "../integration/switch";
import type { Store } from "../store";

export async function buildExitMessage(store: Store, session: Session): Promise<string> {
  await store.conversation.pruneEmpty();
  const report = await session.report();
  const active = await store.conversation.query().byId(store.conversationId).executeAndTakeFirst();
  const hint = active ? `\n${formatRestoreHint(store.conversationId)}` : "";
  return `\n${report}${hint}\n`;
}
