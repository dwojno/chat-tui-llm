import assert from "node:assert";
import type { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { RagConfig } from "./config";

/** Per-profile object storage contract (S3/MinIO in prod, fake in tests). */
export interface ObjectStore {
  ensureBucket(profileId: string): Promise<void>;
  put(profileId: string, key: string, body: string): Promise<void>;
  getText(profileId: string, key: string): Promise<string>;
  getRange(profileId: string, key: string, start: number, end: number): Promise<string>;
  getStream(profileId: string, key: string): Promise<Readable>;
  list(profileId: string): Promise<string[]>;
  remove(profileId: string, key: string): Promise<void>;
}

/**
 * Per-profile object storage on MinIO/S3 (internal to the `sources` domain).
 * Each profile gets its own bucket: `${prefix}${profileId}`.
 */
export class BlobStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly ensured = new Set<string>();

  constructor(private readonly config: RagConfig) {
    this.client = new S3Client({
      endpoint: config.minioEndpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.minioAccessKey,
        secretAccessKey: config.minioSecretKey,
      },
    });
  }

  bucketFor(profileId: string): string {
    const raw = `${this.config.minioBucketPrefix}${profileId}`.toLowerCase();
    const name = raw.replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
    assert(name.length >= 3 && name.length <= 63, `Invalid bucket name: ${name}`);
    return name;
  }

  async ensureBucket(profileId: string): Promise<void> {
    const bucket = this.bucketFor(profileId);
    if (this.ensured.has(bucket)) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    this.ensured.add(bucket);
  }

  async put(profileId: string, key: string, body: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(profileId),
        Key: key,
        Body: body,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
  }

  async getText(profileId: string, key: string): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketFor(profileId), Key: key }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body.transformToString("utf-8");
  }

  /** Byte range read via S3 `Range` (inclusive start/end). */
  async getRange(profileId: string, key: string, start: number, end: number): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketFor(profileId),
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body.transformToString("utf-8");
  }

  /** Streaming read for line-by-line processing (grep). */
  async getStream(profileId: string, key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketFor(profileId), Key: key }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body as Readable;
  }

  async list(profileId: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketFor(profileId),
          ContinuationToken: token,
        }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key) keys.push(item.Key);
      }
      token = response.NextContinuationToken;
    } while (token);
    return keys;
  }

  async remove(profileId: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(profileId), Key: key }),
    );
  }
}
