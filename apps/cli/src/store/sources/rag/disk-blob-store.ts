import assert from "node:assert";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { BlobStore } from "./blob-store";
import type { RagConfig } from "@/platform/config";

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class DiskBlobStore implements BlobStore {
  private readonly blobDir: string;

  constructor(config: RagConfig) {
    this.blobDir = resolve(config.blobDir);
  }

  private namespaceDir(namespace: string): string {
    const dir = resolve(this.blobDir, namespace);
    assert(isWithin(this.blobDir, dir), `Invalid namespace: ${namespace}`);
    return dir;
  }

  private fileFor(namespace: string, key: string): string {
    const dir = this.namespaceDir(namespace);
    const file = resolve(dir, key);
    assert(isWithin(dir, file), `Invalid key: ${key}`);
    return file;
  }

  async init(namespace: string): Promise<void> {
    await mkdir(this.namespaceDir(namespace), { recursive: true });
  }

  async put(namespace: string, key: string, body: string): Promise<void> {
    const file = this.fileFor(namespace, key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body, "utf8");
  }

  async getText(namespace: string, key: string): Promise<string> {
    return readFile(this.fileFor(namespace, key), "utf8");
  }

  async getRange(namespace: string, key: string, start: number, end: number): Promise<string> {
    const buffer = await readFile(this.fileFor(namespace, key));
    return buffer.subarray(start, end + 1).toString("utf8");
  }

  async getStream(namespace: string, key: string): Promise<Readable> {
    return createReadStream(this.fileFor(namespace, key));
  }

  async list(namespace: string): Promise<string[]> {
    const dir = this.namespaceDir(namespace);
    try {
      const entries = await readdir(dir, { recursive: true, withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
    } catch {
      return []; // namespace not created yet
    }
  }

  async remove(namespace: string, key: string): Promise<void> {
    await rm(this.fileFor(namespace, key), { force: true });
  }
}
