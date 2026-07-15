import type { OpenAI } from "openai";
import type { BlobStore } from "./blob-store";
import type { RagConfig } from "./config";
import { DiskBlobStore } from "./disk-blob-store";
import { OpenAIDenseEmbedder } from "./embeddings";
import { RagEngine } from "./engine";
import { QdrantIndex } from "./qdrant";
import { LlmReranker } from "./reranker";
import { S3BlobStore } from "./s3-blob-store";

export interface RagDeps {
  engine: RagEngine;
}

export function createRagDeps(openai: OpenAI, config: RagConfig): RagDeps {
  const embedder = new OpenAIDenseEmbedder(openai, config.openaiEmbeddingModel);
  const blob: BlobStore =
    config.blobBackend === "s3" ? new S3BlobStore(config) : new DiskBlobStore(config);
  const index = new QdrantIndex(config);
  const reranker = new LlmReranker(openai, config.rerankModel);
  return { engine: new RagEngine(config, embedder, blob, index, reranker) };
}
