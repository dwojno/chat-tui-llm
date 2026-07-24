import { LocalStore } from "@/backend";

export function openMemoryStore() {
  return LocalStore.open(":memory:");
}
