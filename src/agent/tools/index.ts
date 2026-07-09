import type { z } from "zod";
import type { TurnEvent } from "../events/events";
import type { ToolRunContext } from "../conversation/turn";
import type { ToolDefinition } from "./types";

export { toOpenAITool, type ToolDefinition } from "./types";

/**
 * Tool-registry helpers. The agent core ships with no tools of its own — the
 * host composes `ToolDefinition`s (see `src/integration/tools/`) and injects
 * them via `AgentConfig`. These helpers resolve a call against a given list.
 */
export function describeToolCall(
  tools: ToolDefinition<z.ZodType>[],
  name: string,
  argsJson: string,
): string | undefined {
  const tool = tools.find((t) => t.name === name);
  if (!tool?.summarize) return undefined;
  try {
    return tool.summarize(tool.parameters.parse(JSON.parse(argsJson)));
  } catch {
    return undefined;
  }
}

export function executeToolCall(
  tools: ToolDefinition<z.ZodType>[],
  name: string,
  argsJson: string,
  ctx?: ToolRunContext,
): AsyncGenerator<TurnEvent, string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const args = tool.parameters.parse(JSON.parse(argsJson));
  return tool.execute(args, ctx);
}

/** The label the UI should show for a tool call (falls back to the raw name). */
export function toolLabel(tools: ToolDefinition<z.ZodType>[], name: string): string | undefined {
  return tools.find((t) => t.name === name)?.label;
}
