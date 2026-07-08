import type { Step } from "./types";

export type SoloStep = { type: "solo"; step: Step; flatIndex: number };

export type GroupedSteps = {
  type: "group";
  parent: Step;
  parentFlatIndex: number;
  children: Array<{ step: Step; flatIndex: number }>;
};

export type DisplayStep = SoloStep | GroupedSteps;

export function buildStepDisplay(steps: Step[]): DisplayStep[] {
  const forkGroups = new Map<string, GroupedSteps>();
  const ordered: DisplayStep[] = [];
  let flatIndex = 0;

  for (const step of steps) {
    const idx = flatIndex++;

    if (step.fork) {
      const key = step.fork;
      let group = forkGroups.get(key);
      if (!group) {
        group = {
          type: "group",
          parent: { label: key },
          parentFlatIndex: idx,
          children: [],
        };
        forkGroups.set(key, group);
        ordered.push(group);
      }
      group.children.push({ step, flatIndex: idx });
      continue;
    }

    if (step.label === "Delegating" && step.detail) {
      const key = step.detail;
      const existing = forkGroups.get(key);
      if (existing) {
        existing.parent = step;
        existing.parentFlatIndex = idx;
      } else {
        const group: GroupedSteps = {
          type: "group",
          parent: step,
          parentFlatIndex: idx,
          children: [],
        };
        forkGroups.set(key, group);
        ordered.push(group);
      }
      continue;
    }

    ordered.push({ type: "solo", step, flatIndex: idx });
  }

  return ordered;
}

export function summarizeSteps(steps: Step[]): string {
  const display = buildStepDisplay(steps);
  let delegations = 0;
  let subSteps = 0;
  let solo = 0;

  for (const item of display) {
    if (item.type === "group") {
      delegations += 1;
      subSteps += item.children.length;
    } else {
      solo += 1;
    }
  }

  const parts: string[] = [];
  if (delegations > 0) {
    parts.push(`${delegations} delegation${delegations === 1 ? "" : "s"}`);
  }
  if (subSteps > 0) {
    parts.push(`${subSteps} sub-step${subSteps === 1 ? "" : "s"}`);
  }
  if (solo > 0) {
    parts.push(`${solo} step${solo === 1 ? "" : "s"}`);
  }

  return parts.join(" · ") || `${steps.length} steps`;
}
