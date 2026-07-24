import type { TurnOptions } from "@chat/agent/conversation/options";
import type { StructuredResponse } from "./schemas";

export function formatAssistantContent(
  answer: string | undefined,
  sources: string[] | undefined,
): string {
  const sourceList = sources?.length ? sources.join("\n") : "";
  return sourceList ? `${answer ?? ""}\n\nSources: ${sourceList}` : (answer ?? "");
}

export function formatResponse(
  result: { outputText: string; outputParsed: unknown },
  options: Pick<TurnOptions, "structured_output" | "json_mode">,
): string {
  if (options.structured_output) {
    const parsed = result.outputParsed as StructuredResponse | null;
    return formatAssistantContent(parsed?.answer, parsed?.sources);
  }
  return result.outputText;
}
