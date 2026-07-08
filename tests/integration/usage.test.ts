import { describe, expect, it } from "vitest";
import { formatReport, formatUsageBar, type UsageTotals } from "../../src/integration/usage";

describe("formatUsageBar", () => {
  it("shows a placeholder when no turns have completed", () => {
    expect(
      formatUsageBar({ actualInput: 0, cachedInput: 0, output: 0, summarizer: 0, turns: 0 }),
    ).toBe("No usage yet");
  });

  it("formats input, output, total, cache hint, and turn count", () => {
    expect(
      formatUsageBar({
        actualInput: 95277,
        cachedInput: 9728,
        output: 11898,
        summarizer: 14992,
        turns: 49,
      }),
    ).toBe("↑ 95,277 in (9,728 cached) · ↓ 11,898 out · 122,167 total · 49 turns");
  });

  it("omits the cache parenthetical when nothing was cached", () => {
    expect(
      formatUsageBar({
        actualInput: 200,
        cachedInput: 0,
        output: 50,
        summarizer: 30,
        turns: 1,
      }),
    ).toBe("↑ 200 in · ↓ 50 out · 280 total · 1 turn");
  });
});

describe("formatReport", () => {
  it("reports nothing before any turns", () => {
    const totals: UsageTotals = {
      actualInput: 0,
      cachedInput: 0,
      output: 0,
      summarizer: 0,
      baselineInput: 0,
      turns: 0,
    };
    expect(formatReport(totals)).toContain("No turns recorded");
  });

  it("reports savings vs the naive baseline, charging summarizer overhead", () => {
    const totals: UsageTotals = {
      actualInput: 200,
      cachedInput: 80,
      output: 50,
      summarizer: 30,
      baselineInput: 1000,
      turns: 1,
    };
    const report = formatReport(totals);
    expect(report).toContain("Context report — 1 turn");
    expect(report).toMatch(/served from cache:\s+80 tok \(40%\)/);
    // saved = baseline(1000) - (actualInput 200 + summarizer 30) = 770
    expect(report).toMatch(/Saved vs naive:\s+770 tok/);
  });
});
