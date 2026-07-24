import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStore, type Store } from "@/store";
import { createFakeRag, type FakeRag } from "@tests/helpers/fake-rag";
import { drain } from "@chat/platform/utils/async-gen";

const GUIDE = [
  "# Deployment Guide",
  "",
  "## Database Setup",
  "",
  "Configure the PostgreSQL connection string and run migrations first.",
  "",
  "## Caching Layer",
  "",
  "Enable Redis caching to speed up repeated queries.",
].join("\n");

describe("sources RAG pipeline", () => {
  let dir: string;
  let cwd: string;
  let store: Store;
  let rag: FakeRag;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "rag-pipeline-"));
    cwd = process.cwd();
    process.chdir(dir);
    writeFileSync("guide.md", GUIDE);
    rag = createFakeRag({ chunkTokens: 128, chunkOverlap: 16 });
    store = await LocalStore.open(":memory:", { rag: rag.deps });
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes a file, uploads to object storage, and marks it indexed", async () => {
    const result = await drain(store.sources.add(store.profileId, "guide.md"));
    expect(result.status).toBe("indexed");
    expect(result.chunkCount).toBeGreaterThanOrEqual(2);

    const bucket = rag.blob.buckets.get(store.profileId);
    expect(bucket?.has("guide.md.md")).toBe(true);

    const row = await store.sources.query().forProfile(store.profileId).executeAndTakeFirst();
    expect(row?.status).toBe("indexed");
    expect(row?.s3Key).toBe("guide.md.md");
    expect(row?.chunkCount).toBe(result.chunkCount);
  });

  it("hybrid-searches and returns the matching passage with line range", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));

    const hits = await store.sources.search(
      store.profileId,
      "configure postgresql connection string migrations",
      { limit: 3 },
    );

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("guide.md");
    expect(hits[0]?.startLine).toBe(5);
    expect(hits[0]?.snippet).toContain("PostgreSQL");
  });

  it("lists indexed files", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));
    expect(await store.sources.listFiles(store.profileId)).toEqual(["guide.md"]);
  });

  it("greps raw file text streamed from object storage", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));
    const matches = [];
    for await (const match of store.sources.grep(store.profileId, "Redis")) matches.push(match);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("guide.md");
    expect(matches[0]?.line).toBe(9);
    expect(matches[0]?.text).toContain("Redis");
  });

  it("reads a line range from object storage", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));
    const text = await store.sources.readFile(store.profileId, "guide.md", {
      kind: "lines",
      start: 1,
      end: 1,
    });
    expect(text).toBe("# Deployment Guide");
  });

  it("removes a source from the DB, object storage, and the vector index", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));
    const row = await store.sources.query().forProfile(store.profileId).executeAndTakeFirst();
    expect(row).toBeDefined();

    await store.sources.remove(store.profileId, row!.id);

    expect(await store.sources.listFiles(store.profileId)).toEqual([]);
    expect(rag.blob.buckets.get(store.profileId)?.has("guide.md.md")).toBe(false);
    const hits = await store.sources.search(store.profileId, "postgresql", { limit: 3 });
    expect(hits).toEqual([]);
  });

  it("streams progress steps while indexing, then returns the result", async () => {
    const steps: string[] = [];
    const gen = store.sources.add(store.profileId, "guide.md");
    let next = await gen.next();
    while (!next.done) {
      steps.push(next.value.message);
      next = await gen.next();
    }
    expect(steps.some((s) => s.includes("embedding"))).toBe(true);
    expect(next.value.status).toBe("indexed");
  });

  it("re-indexing replaces stale chunks instead of duplicating", async () => {
    await drain(store.sources.add(store.profileId, "guide.md"));
    const first = rag.index.collections.get(store.profileId)?.length ?? 0;
    await drain(store.sources.reindex(store.profileId));
    const second = rag.index.collections.get(store.profileId)?.length ?? 0;
    expect(second).toBe(first);
  });
});
