import type { OneOrMany } from "@chat/store";

export function asArray<T>(value: OneOrMany<T>): T[] {
  return Array.isArray(value) ? value : [value];
}

export type { OneOrMany } from "@chat/store";
