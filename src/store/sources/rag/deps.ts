import type { OpenAI } from "openai";
import { BlobStore } from "./blob";
import type { RagConfig } from "./config";
import { OpenAIDenseEmbedder } from "./embeddings";
import { RagEngine } from "./engine";
import { QdrantIndex } from "./qdrant";
import { LlmReranker } from "./reranker";

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
  const blob = new BlobStore(config);
  const index = new QdrantIndex(config);
  const reranker = new LlmReranker(openai, config.rerankModel);
  return { engine: new RagEngine(config, embedder, blob, index, reranker) };
}
