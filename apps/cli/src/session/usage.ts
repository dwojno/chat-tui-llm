import type { UsageTotals } from "@chat/store";

export type { UsageTotals } from "@chat/store";

export type UsageSnapshot = Omit<UsageTotals, "baselineInput" | "managedInput">;

const formatNumber = (value: number): string => value.toLocaleString("en-US");
const formatPercent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

export function usageSnapshot(totals: UsageTotals): UsageSnapshot {
  const { actualInput, cachedInput, output, summarizer, forkInput, turns } = totals;
  return { actualInput, cachedInput, output, summarizer, forkInput, turns };
}

export function formatUsageBar(snapshot: UsageSnapshot): string {
  if (snapshot.turns === 0) return "No usage yet";

  const total = snapshot.actualInput + snapshot.output + snapshot.summarizer;
  const cached = snapshot.cachedInput > 0 ? ` (${formatNumber(snapshot.cachedInput)} cached)` : "";

  return [
    `↑ ${formatNumber(snapshot.actualInput)} in${cached}`,
    `↓ ${formatNumber(snapshot.output)} out`,
    `${formatNumber(total)} total`,
    `${formatNumber(snapshot.turns)} turn${snapshot.turns === 1 ? "" : "s"}`,
  ].join(" · ");
}

export function formatReport(totals: UsageTotals): string {
  if (totals.turns === 0) return "No turns recorded — nothing to report.";

  const netManaged = totals.managedInput + totals.summarizer;
  const saved = totals.baselineInput - netManaged;
  const forkLine =
    totals.forkInput > 0
      ? `    └ fork / handoff:      ${formatNumber(totals.forkInput)} tok`
      : null;

  return [
    `Context report — ${totals.turns} turn${totals.turns === 1 ? "" : "s"}`,
    `  Input sent (actual):     ${formatNumber(totals.actualInput)} tok`,
    `    └ served from cache:   ${formatNumber(totals.cachedInput)} tok (${formatPercent(totals.cachedInput, totals.actualInput)})`,
    ...(forkLine ? [forkLine] : []),
    `  Summarizer overhead:     ${formatNumber(totals.summarizer)} tok`,
    `  Naive append-all input:  ${formatNumber(totals.baselineInput)} tok`,
    `  Saved vs naive:          ${formatNumber(saved)} tok (${formatPercent(saved, totals.baselineInput)})`,
    `  Output generated:        ${formatNumber(totals.output)} tok`,
  ].join("\n");
}
