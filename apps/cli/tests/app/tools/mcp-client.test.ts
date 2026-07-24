import { describe, expect, it, vi } from "vitest";
import { mcpToolToDefinition } from "@/app/tools/mcp/client";
import { toOpenAITool } from "@chat/agent/tools/types";

const tool = {
  name: "browser_navigate",
  description: "Open a URL",
  inputSchema: {
    type: "object" as const,
    properties: { url: { type: "string" } },
    required: ["url"],
  },
};

describe("mcpToolToDefinition", () => {
  it("prefixes the tool name with a sanitized server label", () => {
    const def = mcpToolToDefinition({ callTool: vi.fn() }, "my server!", tool);
    expect(def.name).toBe("my_server___browser_navigate");
    expect(def.requiresApproval).toBe(true);
  });

  it("exposes the raw MCP schema to the model as a non-strict tool", () => {
    const def = mcpToolToDefinition({ callTool: vi.fn() }, "pw", tool);
    const wire = toOpenAITool(def);
    expect(wire.strict).toBe(false);
    expect(wire.parameters).toEqual(tool.inputSchema);
  });

  it("proxies execute to callTool and flattens text content", async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
        { type: "image", data: "..." },
      ],
    });
    const def = mcpToolToDefinition({ callTool }, "pw", tool);

    const out = await def.execute({ url: "https://x" });
    expect(callTool).toHaveBeenCalledWith({
      name: "browser_navigate",
      arguments: { url: "https://x" },
    });
    expect(out).toBe("line 1\nline 2");
  });

  it("returns an error string instead of throwing when the call fails", async () => {
    const callTool = vi.fn().mockRejectedValue(new Error("boom"));
    const def = mcpToolToDefinition({ callTool }, "pw", tool);
    const out = await def.execute({ url: "https://x" });
    expect(out).toContain("MCP error (pw__browser_navigate)");
    expect(out).toContain("boom");
  });
});
