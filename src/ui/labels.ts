import { forkTools, mainTools } from "../tools";

/**
 * Human-friendly labels for the raw tool names the harness emits. The event
 * stream stays UI-agnostic and carries only machine names (see
 * `conversation/events.ts`); each surface localizes them here. Derived from the
 * tool definitions themselves (main + fork tools) so a new tool's `label` shows
 * up automatically — unknown names fall back to a readable default.
 */
const TOOL_LABELS: Record<string, string> = [...mainTools, ...forkTools].reduce(
  (acc, tool) => {
    acc[tool.name] = tool.label;
    return acc;
  },
  {} as Record<string, string>,
);

/** Map a tool name to the label shown in the thinking trace. */
export function toolStepLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}
