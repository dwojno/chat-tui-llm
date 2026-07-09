import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRagTools } from "../../../src/integration/rag/tools";
import { LocalStore, type Store } from "../../../src/store";
import { createFakeRag } from "../../helpers/fake-rag";
import { drain } from "../../../src/utils/async-gen";

const DOC = ["# API", "", "## Auth", "", "Send a bearer token in the Authorization header."].join(
  "\n",
);

type LooseTool = {
  name: string;
  execute: (args: any, ctx?: unknown) => AsyncGenerator<unknown, string>;
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

  it("exposes the four RAG tools", () => {
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      "grep_files",
      "list_files",
      "read_file",
      "search_knowledge_base",
    ]);
  });

  it("search_knowledge_base returns path:line citations", async () => {
    const out = await drain(
      tool(tools, "search_knowledge_base").execute(
        { query: "bearer token authorization header", limit: 3 },
        undefined,
      ),
    );
    expect(out).toContain("api.md:");
    expect(out).toContain("Authorization");
  });

  it("list_files lists indexed files", async () => {
    const out = await drain(tool(tools, "list_files").execute({}, undefined));
    expect(out).toContain("api.md");
  });

  it("grep_files streams status events and returns matching lines", async () => {
    const gen = tool(tools, "grep_files").execute(
      { pattern: "bearer", paths: null, ignoreCase: true, maxMatches: null },
      undefined,
    );
    const events: unknown[] = [];
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }
    // At least one streamed status event (grep header + per-match) before the result.
    expect(events.some((e) => (e as { type?: string }).type === "status")).toBe(true);
    expect(next.value).toMatch(/api\.md:\d+:.*bearer/i);
  });

  it("read_file returns a line range", async () => {
    const out = await drain(
      tool(tools, "read_file").execute(
        { path: "api.md", mode: "lines", start: 1, end: 1 },
        undefined,
      ),
    );
    expect(out).toBe("# API");
  });

  it("reports a friendly message when the knowledge base is unconfigured", async () => {
    const plain = await LocalStore.open(":memory:");
    const plainTools = createRagTools(plain);
    await expect(
      drain(
        tool(plainTools, "search_knowledge_base").execute({ query: "x", limit: null }, undefined),
      ),
    ).rejects.toThrow(/not configured/);
  });
});
