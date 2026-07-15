import type { ResponseUsage } from "openai/resources/responses/responses.mjs";

export interface UsageTotals {
  actualInput: number;
  cachedInput: number;
  output: number;
  summarizer: number;
  baselineInput: number;
  turns: number;
}

export type UsageSnapshot = Omit<UsageTotals, "baselineInput">;

export const EMPTY_USAGE: UsageTotals = {
  actualInput: 0,
  cachedInput: 0,
  output: 0,
  summarizer: 0,
  baselineInput: 0,
  turns: 0,
};

const formatNumber = (value: number): string => value.toLocaleString("en-US");
const formatPercent = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

export function addResponseUsage(totals: UsageTotals, usage: ResponseUsage | undefined): void {
  if (!usage) return;
  totals.actualInput += usage.input_tokens;
  totals.cachedInput += usage.input_tokens_details?.cached_tokens ?? 0;
  totals.output += usage.output_tokens;
}

export function addSummarizerUsage(totals: UsageTotals, usage: ResponseUsage | undefined): void {
  if (!usage) return;
  totals.summarizer += usage.total_tokens;
}

export function usageSnapshot(totals: UsageTotals): UsageSnapshot {
  const { actualInput, cachedInput, output, summarizer, turns } = totals;
  return { actualInput, cachedInput, output, summarizer, turns };
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

  const netInput = totals.actualInput + totals.summarizer;
  const saved = totals.baselineInput - netInput;

  return [
    `Context report — ${totals.turns} turn${totals.turns === 1 ? "" : "s"}`,
    `  Input sent (actual):     ${formatNumber(totals.actualInput)} tok`,
    `    └ served from cache:   ${formatNumber(totals.cachedInput)} tok (${formatPercent(totals.cachedInput, totals.actualInput)})`,
    `  Summarizer overhead:     ${formatNumber(totals.summarizer)} tok`,
    `  Naive append-all input:  ${formatNumber(totals.baselineInput)} tok`,
    `  Saved vs naive:          ${formatNumber(saved)} tok (${formatPercent(saved, totals.baselineInput)})`,
    `  Output generated:        ${formatNumber(totals.output)} tok`,
  ].join("\n");
}
