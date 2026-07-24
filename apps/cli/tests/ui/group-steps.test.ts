import { describe, expect, it } from "vitest";
import { buildStepDisplay, summarizeSteps } from "@/ui/group-steps";
import type { Step } from "@/ui/types";

describe("buildStepDisplay", () => {
  it("nests fork-tagged steps under their matching delegation", () => {
    const steps: Step[] = [
      { label: "Delegating", detail: "Nirvana Overview" },
      { label: "Delegating", detail: "Soundgarden Overview" },
      { label: "Searching the web", detail: "nirvana history", fork: "Nirvana Overview" },
      { label: "Searching the web", detail: "soundgarden history", fork: "Soundgarden Overview" },
      { label: "Searching the web", detail: "nirvana style", fork: "Nirvana Overview" },
    ];

    const display = buildStepDisplay(steps);

    expect(display).toHaveLength(2);
    expect(display[0]).toMatchObject({
      type: "group",
      parent: { label: "Delegating", detail: "Nirvana Overview" },
      children: [
        { step: { detail: "nirvana history", fork: "Nirvana Overview" } },
        { step: { detail: "nirvana style", fork: "Nirvana Overview" } },
      ],
    });
    expect(display[1]).toMatchObject({
      type: "group",
      parent: { label: "Delegating", detail: "Soundgarden Overview" },
      children: [{ step: { detail: "soundgarden history", fork: "Soundgarden Overview" } }],
    });
  });

  it("leaves non-delegation steps at the top level", () => {
    const steps: Step[] = [
      { label: "Fetching weather data", detail: "Paris" },
      { label: "Delegating", detail: "Research" },
      { label: "Searching the web", detail: "ssr", fork: "Research" },
    ];

    const display = buildStepDisplay(steps);

    expect(display[0]).toEqual({
      type: "solo",
      step: { label: "Fetching weather data", detail: "Paris" },
      flatIndex: 0,
    });
    expect(display[1]).toMatchObject({
      type: "group",
      parent: { label: "Delegating", detail: "Research" },
    });
  });

  it("summarizes grouped steps for collapsed display", () => {
    const steps: Step[] = [
      { label: "Delegating", detail: "Nirvana Overview" },
      { label: "Delegating", detail: "Soundgarden Overview" },
      { label: "Searching the web", detail: "nirvana", fork: "Nirvana Overview" },
      { label: "Searching the web", detail: "soundgarden", fork: "Soundgarden Overview" },
      { label: "Fetching weather data", detail: "Paris" },
    ];

    expect(summarizeSteps(steps)).toBe("2 delegations · 2 sub-steps · 1 step");
  });

  it("upgrades a placeholder parent when the delegation step arrives later", () => {
    const steps: Step[] = [
      { label: "Searching the web", detail: "q", fork: "Research" },
      { label: "Delegating", detail: "Research" },
    ];

    const display = buildStepDisplay(steps);

    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({
      type: "group",
      parent: { label: "Delegating", detail: "Research" },
      children: [{ step: { detail: "q", fork: "Research" } }],
    });
  });
});
