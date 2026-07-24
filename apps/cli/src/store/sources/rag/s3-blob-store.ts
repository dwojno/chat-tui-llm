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
import type { BlobStore } from "./blob-store";
import type { RagConfig } from "@/platform/config";

const S3_MAX_ATTEMPTS = 4;

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly ensured = new Set<string>();

  constructor(private readonly config: RagConfig) {
    this.client = new S3Client({
      endpoint: config.minioEndpoint,
      region: "us-east-1",
      forcePathStyle: true,
      maxAttempts: S3_MAX_ATTEMPTS,
      credentials: {
        accessKeyId: config.minioAccessKey,
        secretAccessKey: config.minioSecretKey,
      },
    });
  }

  private bucketFor(namespace: string): string {
    const raw = `${this.config.minioBucketPrefix}${namespace}`.toLowerCase();
    const name = raw.replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
    assert(name.length >= 3 && name.length <= 63, `Invalid bucket name: ${name}`);
    return name;
  }

  async init(namespace: string): Promise<void> {
    const bucket = this.bucketFor(namespace);
    if (this.ensured.has(bucket)) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    this.ensured.add(bucket);
  }

  async put(namespace: string, key: string, body: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(namespace),
        Key: key,
        Body: body,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
  }

  async getText(namespace: string, key: string): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketFor(namespace), Key: key }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body.transformToString("utf-8");
  }

  async getRange(namespace: string, key: string, start: number, end: number): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketFor(namespace),
        Key: key,
        Range: `bytes=${start}-${end}`,
      }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body.transformToString("utf-8");
  }

  async getStream(namespace: string, key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketFor(namespace), Key: key }),
    );
    assert(response.Body, `Missing object body: ${key}`);
    return response.Body as Readable;
  }

  async list(namespace: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketFor(namespace),
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

  async remove(namespace: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketFor(namespace), Key: key }),
    );
  }
}
