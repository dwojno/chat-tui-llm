import { LocalStore } from "@/store";

export function openMemoryStore() {
  return LocalStore.open(":memory:");
}
