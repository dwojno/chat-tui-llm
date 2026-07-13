import type { Readable } from "node:stream";

/**
 * Storage-neutral blob store for the `sources` domain. Backends (local disk,
 * S3/MinIO) are equal adapters behind this contract — nothing S3-specific
 * (buckets, regions) leaks here. A `namespace` isolates one logical group of
 * objects (one per profile); a `key` is the logical object id within it.
 */
export interface BlobStore {
  /** Prepare a namespace so subsequent writes succeed (idempotent). */
  init(namespace: string): Promise<void>;
  put(namespace: string, key: string, body: string): Promise<void>;
  getText(namespace: string, key: string): Promise<string>;
  /** Inclusive byte range read (start/end both included). */
  getRange(namespace: string, key: string, start: number, end: number): Promise<string>;
  /** Streaming read for line-by-line processing (grep). */
  getStream(namespace: string, key: string): Promise<Readable>;
  list(namespace: string): Promise<string[]>;
  remove(namespace: string, key: string): Promise<void>;
}
