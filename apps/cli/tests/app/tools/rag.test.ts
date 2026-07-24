import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRagTools } from "@/app/tools/rag";
import { EventBus } from "@chat/agent/events/bus";
import type { TurnEvent } from "@chat/agent/events/events";
import type { ToolRunContext } from "@chat/agent/conversation/turn";
import { LocalStore, type Store } from "@/store";
import { createFakeRag } from "@tests/helpers/fake-rag";
import { drain } from "@chat/platform/utils/async-gen";

const DOC = ["# API", "", "## Auth", "", "Send a bearer token in the Authorization header."].join(
  "\n",
);

type LooseTool = {
  name: string;
  execute: (args: any, ctx?: ToolRunContext) => Promise<string>;
};

function tool(tools: ReturnType<typeof createRagTools>, name: string): LooseTool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found as unknown as LooseTool;
}

describe("createRagTools", () => {
  let dir: string;
  let cwd: string;
  let store: Store;
  let tools: ReturnType<typeof createRagTools>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rag-tools-"));
    cwd = process.cwd();
    process.chdir(dir);
    writeFileSync("api.md", DOC);
    store = await LocalStore.open(":memory:", { rag: createFakeRag().deps });
    await drain(store.sources.add(store.profileId, "api.md"));
    tools = createRagTools(store);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exposes search, list, grep, and read_source (no main-agent read_file)", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "grep_files",
      "list_files",
      "read_source",
      "search_knowledge_base",
    ]);
  });

  it("search_knowledge_base returns path:line pointers and points at read_source", async () => {
    const out = await tool(tools, "search_knowledge_base").execute({
      query: "bearer token authorization header",
      limit: 3,
    });
    expect(out).toContain("api.md:");
    expect(out).toContain("read_source");
  });

  it("list_files lists indexed files", async () => {
    const out = await tool(tools, "list_files").execute({});
    expect(out).toContain("api.md");
  });

  it("grep_files emits status events and returns matching lines", async () => {
    const events: TurnEvent[] = [];
    const bus = new EventBus();
    bus.subscribe((e) => events.push(e));
    const out = await tool(tools, "grep_files").execute(
      { pattern: "bearer", paths: null, ignoreCase: true, maxMatches: null },
      { bus } as unknown as ToolRunContext,
    );
    expect(events.some((e) => e.type === "status")).toBe(true);
    expect(out).toMatch(/api\.md:\d+:.*bearer/i);
  });

  it("read_source returns a line range", async () => {
    const out = await tool(tools, "read_source").execute({
      path: "api.md",
      mode: "lines",
      start: 1,
      end: 1,
    });
    expect(out).toBe("# API");
  });

  it("reports a friendly message when the knowledge base is unconfigured", async () => {
    const plain = await LocalStore.open(":memory:");
    const plainTools = createRagTools(plain);
    await expect(
      tool(plainTools, "search_knowledge_base").execute({ query: "x", limit: null }),
    ).rejects.toThrow(/not configured/);
  });
});
