import type { Readable } from "node:stream";

export interface BlobStore {
  init(namespace: string): Promise<void>;
  put(namespace: string, key: string, body: string): Promise<void>;
  getText(namespace: string, key: string): Promise<string>;
  getRange(namespace: string, key: string, start: number, end: number): Promise<string>;
  getStream(namespace: string, key: string): Promise<Readable>;
  list(namespace: string): Promise<string[]>;
  remove(namespace: string, key: string): Promise<void>;
}
