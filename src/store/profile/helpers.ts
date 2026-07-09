import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PROFILE_ID } from "./profile.repository";

export { DEFAULT_PROFILE_ID };

interface ActivePointer {
  profileId: string;
}

function activeJsonPath(dbPath: string): string {
  return join(dirname(dbPath), "active.json");
}

export function readActivePointer(dbPath: string): ActivePointer {
  try {
    const raw = readFileSync(activeJsonPath(dbPath), "utf8");
    const parsed = JSON.parse(raw) as ActivePointer;
    if (parsed.profileId) return { profileId: parsed.profileId };
  } catch {
    // fall through
  }

  return { profileId: DEFAULT_PROFILE_ID };
}

export function writeActivePointer(dbPath: string, pointer: ActivePointer): void {
  const path = activeJsonPath(dbPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pointer), "utf8");
}

export function slugifyProfileId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}
