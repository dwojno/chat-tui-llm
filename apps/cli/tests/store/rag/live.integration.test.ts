import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenAI } from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRagDeps, LocalStore, type Store } from "@/store";
import { loadConfig } from "@/platform/config";
import { drain } from "@chat/platform/utils/async-gen";

const RUN = process.env.RAG_INTEGRATION === "1";

describe.runIf(RUN)("live RAG (MinIO + Qdrant + OpenAI)", () => {
  let dir: string;
  let cwd: string;
  let store: Store;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rag-live-"));
    cwd = process.cwd();
    process.chdir(dir);
    writeFileSync(
      "guide.md",
      "# Deployment\n\n## Database\n\nConfigure the PostgreSQL connection string and run migrations.\n",
    );
    const openai = new OpenAI();
    const { rag } = loadConfig(process.env);
    store = await LocalStore.open(":memory:", { rag: createRagDeps(openai, rag) });
  });

  afterAll(async () => {
    const rows = await store.sources.query().forProfile(store.profileId).execute();
    for (const row of rows) await store.sources.remove(store.profileId, row.id);
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes and hybrid-searches end to end", async () => {
    const result = await drain(store.sources.add(store.profileId, "guide.md"));
    expect(result.status).toBe("indexed");

    const hits = await store.sources.search(
      store.profileId,
      "how do I configure the postgres connection and migrations",
      { limit: 3 },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("guide.md");
    expect(hits[0]?.snippet.toLowerCase()).toContain("postgresql");
  }, 60_000);
});
