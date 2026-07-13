import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PROFILE_ID } from "./profile/profile.repository";

/**
 * The persisted "active state" pointer — which profile and conversation to
 * restore on the next launch. Serialized to a single `active.json` next to the
 * SQLite database. Written whenever the active binding changes (see
 * `StoreContext.bind`); never written for in-memory stores.
 */
export interface ActiveState {
  profileId: string;
  conversationId?: string;
}

function activeStatePath(dbPath: string): string {
  return join(dirname(dbPath), "active.json");
}

/** Read the pointer, tolerating a missing or malformed file. */
export function readActiveState(dbPath: string): ActiveState {
  try {
    const parsed = JSON.parse(readFileSync(activeStatePath(dbPath), "utf8")) as unknown;
    if (parsed && typeof parsed === "object") {
      const { profileId, conversationId } = parsed as Record<string, unknown>;
      if (typeof profileId === "string" && profileId) {
        return typeof conversationId === "string" && conversationId
          ? { profileId, conversationId }
          : { profileId };
      }
    }
  } catch {
    // missing or unreadable — fall through to the default
  }
  return { profileId: DEFAULT_PROFILE_ID };
}

export function writeActiveState(dbPath: string, state: ActiveState): void {
  const path = activeStatePath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
