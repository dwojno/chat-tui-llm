import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAI } from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRagTools } from "@/app/tools/rag";
import type { ToolRunContext } from "@/agent/conversation/turn";
import { createRagDeps, loadRagConfig, LocalStore, type Store } from "@/store";
import { drain } from "@/platform/utils/async-gen";


const RUN = process.env.RAG_INTEGRATION === "1";
const CORPUS = "tests/fixtures/rag-corpus";
const TEST_TIMEOUT = 60_000;

type LooseTool = {
  name: string;
  execute: (args: any, ctx?: ToolRunContext) => Promise<string>;
};

describe.runIf(RUN)("RAG tools (real Qdrant + OpenAI)", () => {
  let blobDir: string;
  let store: Store;
  let tools: ReturnType<typeof createRagTools>;

  const tool = (name: string): LooseTool => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`missing tool ${name}`);
    return found as unknown as LooseTool;
  };

  beforeAll(async () => {
    blobDir = mkdtempSync(join(tmpdir(), "rag-it-"));
    const config = loadRagConfig({
      ...process.env,
      RAG_RERANK_ENABLED: "false",
      RAG_BLOB_BACKEND: "disk",
      RAG_BLOB_DIR: blobDir,
    });
    const openai = new OpenAI();
    store = await LocalStore.open(":memory:", { rag: createRagDeps(openai, config) });
    const profile = await store.profile.create("it-rag-tools");
    await store.profile.switchTo(profile.id);
    for (const file of ["handbook.md", "faq.md"]) {
      const result = await drain(store.sources.add(store.profileId, `${CORPUS}/${file}`));
      assert.strictEqual(result.status, "indexed", `failed to index ${file}: ${result.error}`);
    }
    tools = createRagTools(store);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (store) await store.sources.reset(store.profileId);
    if (blobDir) rmSync(blobDir, { recursive: true, force: true });
  });

  it(
    "list_files lists every ingested file",
    async () => {
      const out = await tool("list_files").execute({});
      expect(out).toContain("handbook.md");
      expect(out).toContain("faq.md");
    },
    TEST_TIMEOUT,
  );

  it(
    "search_knowledge_base locates the right file with a scored pointer",
    async () => {
      const out = await tool("search_knowledge_base").execute({
        query: "project storage quota limit",
        limit: null,
      });
      expect(out).toMatch(/handbook\.md:\d+-\d+ \(score \d/);
      expect(out.toLowerCase()).toContain("quota");
      expect(out).toContain("read_source");
    },
    TEST_TIMEOUT,
  );

  it(
    "read_source returns the exact content at a line range",
    async () => {
      const out = await tool("read_source").execute({
        path: `${CORPUS}/handbook.md`,
        mode: "lines",
        start: 5,
        end: 5,
      });
      expect(out).toBe("Each project has a storage quota of 50 GB by default.");
    },
    TEST_TIMEOUT,
  );

  it(
    "grep_files returns the matching line for an exact identifier",
    async () => {
      const out = await tool("grep_files").execute({
        pattern: "NIMBUS_QUOTA_EXCEEDED",
        paths: null,
        ignoreCase: null,
        maxMatches: null,
      });
      expect(out).toMatch(/handbook\.md:\d+: .*NIMBUS_QUOTA_EXCEEDED/);
    },
    TEST_TIMEOUT,
  );
});
