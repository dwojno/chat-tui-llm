import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
} from "openai/resources/responses/responses.mjs";

export function getFunctionCalls(output: ResponseOutputItem[]): ResponseFunctionToolCall[] {
  return output.filter((item) => item.type === "function_call");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return part && typeof part === "object" && "text" in part ? String(part.text) : "";
    })
    .join("");
}

export function renderItemsText(items: ResponseInputItem[]): string {
  const lines: string[] = [];

  for (const item of items) {
    if ("role" in item && "content" in item) {
      const text = contentToText(item.content);
      if (text) lines.push(`${item.role}: ${text}`);
      continue;
    }

    if (item.type === "function_call") {
      lines.push(`assistant called ${item.name}(${item.arguments})`);
    } else if (item.type === "function_call_output") {
      lines.push(`tool result: ${item.output}`);
    }
  }

  return lines.join("\n");
}
