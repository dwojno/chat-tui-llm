import { DEFAULT_PROFILE_ID } from "./profile.repository";

export { DEFAULT_PROFILE_ID };

export function slugifyProfileId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "profile";
}
