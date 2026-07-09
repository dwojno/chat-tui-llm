import { LocalStore } from "../../src/store";

export function openMemoryStore() {
  return LocalStore.open(":memory:");
}
