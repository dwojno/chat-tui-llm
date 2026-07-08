import { forkTools, mainTools } from "../agent/tools";

const TOOL_LABELS: Record<string, string> = [...mainTools, ...forkTools].reduce(
  (acc, tool) => {
    acc[tool.name] = tool.label;
    return acc;
  },
  {} as Record<string, string>,
);

export function toolStepLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}
