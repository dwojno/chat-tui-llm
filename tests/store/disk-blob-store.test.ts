import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskBlobStore } from "../../src/store/sources/rag/disk-blob-store";
import { loadRagConfig } from "../../src/store/sources/rag/config";

let dir: string;
let store: DiskBlobStore;

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "disk-blob-"));
  store = new DiskBlobStore({ ...loadRagConfig({}), blobDir: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("DiskBlobStore", () => {
  it("round-trips objects per namespace", async () => {
    await store.init("profile-a");
    await store.put("profile-a", "docs/readme.md", "hello world");

    expect(await store.getText("profile-a", "docs/readme.md")).toBe("hello world");
    expect(await store.getRange("profile-a", "docs/readme.md", 0, 4)).toBe("hello");
    expect(await streamToString(await store.getStream("profile-a", "docs/readme.md"))).toBe(
      "hello world",
    );
    expect(await store.list("profile-a")).toEqual(["docs/readme.md"]);

    await store.remove("profile-a", "docs/readme.md");
    expect(await store.list("profile-a")).toEqual([]);
  });

  it("isolates namespaces", async () => {
    await store.put("a", "k.md", "in-a");
    await store.put("b", "k.md", "in-b");
    expect(await store.getText("a", "k.md")).toBe("in-a");
    expect(await store.getText("b", "k.md")).toBe("in-b");
  });

  it("returns an empty list for an unknown namespace", async () => {
    expect(await store.list("never-created")).toEqual([]);
  });

  it("rejects key path traversal", async () => {
    await expect(store.put("a", "../escape.md", "x")).rejects.toThrow(/Invalid key/);
  });
});
