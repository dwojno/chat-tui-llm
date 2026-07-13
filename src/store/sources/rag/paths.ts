import { homedir } from "node:os";
import { join } from "node:path";

const APP = "chat-cli";
const SOURCES = "sources";

/**
 * Default directory for on-disk source blobs. In development (or when
 * `CHAT_CLI_STATE_DIR` is set) blobs live in the project-local `.chat-state/`,
 * matching `DB_PATH`. Otherwise they go to an OS-appropriate data directory.
 * Override entirely with `RAG_BLOB_DIR`.
 */
export function defaultBlobDir(env: Record<string, string | undefined> = process.env): string {
  const override = env.CHAT_CLI_STATE_DIR;
  if (override) return join(override, SOURCES);
  if (env.NODE_ENV !== "production") return join(".chat-state", SOURCES);
  return join(osDataDir(env), APP, SOURCES);
}

function osDataDir(env: Record<string, string | undefined>): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  if (process.platform === "win32") {
    return env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  }
  return env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
}
