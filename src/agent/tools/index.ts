import type { z } from "zod";
import type { ToolRunContext } from "../conversation/turn";
import type { ToolDefinition } from "./types";

export { toOpenAITool, type ToolDefinition } from "./types";
export {
  evaluateApproval,
  APPROVAL_DENIED_OUTPUT,
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalNeed,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ApprovalRisk,
} from "../humanLayer/approval";

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
): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const args = tool.parameters.parse(JSON.parse(argsJson));
  return tool.execute(args, ctx);
}

export function toolLabel(tools: ToolDefinition<z.ZodType>[], name: string): string | undefined {
  return tools.find((t) => t.name === name)?.label;
}
