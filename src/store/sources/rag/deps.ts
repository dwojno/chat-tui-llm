import type { OpenAI } from "openai";
import type { BlobStore } from "./blob-store";
import type { RagConfig } from "./config";
import { DiskBlobStore } from "./disk-blob-store";
import { OpenAIDenseEmbedder } from "./embeddings";
import { RagEngine } from "./engine";
import { QdrantIndex } from "./qdrant";
import { LlmReranker } from "./reranker";
import { S3BlobStore } from "./s3-blob-store";

/**
 * The assembled RAG engine plus the raw inputs used to build it. Passed to
 * `SqliteSourcesFacade` so the facade never touches concrete infra clients.
 * Built by `createRagDeps` from just an OpenAI client + config, keeping the
 * domain internals (S3/Qdrant/embeddings) private to this package.
 */
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
