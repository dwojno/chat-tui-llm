import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelOperation, ModelUsage, UsageKind, UsageRecord } from "@chat/agent";

type UsageContext = {
  record: (entry: UsageRecord) => void;
  inFork: boolean;
};

const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageRecorder<T>(
  record: (entry: UsageRecord) => void,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore();
  return storage.run({ record, inFork: parent?.inFork ?? false }, fn);
}

export function withForkUsage<T>(fn: () => Promise<T>): Promise<T> {
  const parent = storage.getStore();
  if (!parent) return fn();
  return storage.run({ record: parent.record, inFork: true }, fn);
}

export function harvestUsage(model: string, operation: ModelOperation, usage: ModelUsage): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  if (usage.inputTokens === 0 && usage.outputTokens === 0 && usage.cachedInputTokens === 0) {
    return;
  }
  ctx.record({
    model,
    kind: kindFrom(operation, ctx.inFork),
    ...usage,
  });
}

function kindFrom(operation: ModelOperation, inFork: boolean): UsageKind {
  if (operation === "summarize") return "summarizer";
  if (operation === "handoff") return "handoff";
  return inFork ? "fork" : "parent";
}
