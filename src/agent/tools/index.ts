import type { z } from "zod";
import type { TurnEvent } from "../events/events";
import type { ToolRunContext } from "../conversation/turn";
import { toOpenAITool, type ToolDefinition } from "./types";
import { weatherTool } from "./weather";
import { webSearchTool } from "./web-search";
import { delegateTaskTool, forkTools } from "./delegate-task";

export { forkTools };

const registry: ToolDefinition<z.ZodType>[] = [weatherTool, webSearchTool, delegateTaskTool];

export const mainTools = [toOpenAITool(weatherTool), toOpenAITool(delegateTaskTool)];

export function describeToolCall(name: string, argsJson: string): string | undefined {
  const tool = registry.find((t) => t.name === name);
  if (!tool?.summarize) return undefined;
  try {
    return tool.summarize(tool.parameters.parse(JSON.parse(argsJson)));
  } catch {
    return undefined;
  }
}

export function executeToolCall(
  name: string,
  argsJson: string,
  ctx?: ToolRunContext,
): AsyncGenerator<TurnEvent, string> {
  const tool = registry.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const args = tool.parameters.parse(JSON.parse(argsJson));
  return tool.execute(args, ctx);
}
