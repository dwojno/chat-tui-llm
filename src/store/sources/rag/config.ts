import { z } from "zod";

/**
 * Environment-driven configuration for the sources RAG pipeline (OpenAI
 * embeddings, MinIO/S3 blob storage, Qdrant vector search, chunking params).
 *
 * Internal to the `sources` domain — only the facade consumes it. Parsing is
 * separated from `process.env` so tests can pass an explicit env map.
 */
const schema = z.object({
  openaiEmbeddingModel: z.string().min(1).default("text-embedding-3-small"),
  minioEndpoint: z.url().default("http://localhost:9000"),
  minioAccessKey: z.string().min(1).default("minioadmin"),
  minioSecretKey: z.string().min(1).default("minioadmin"),
  minioBucketPrefix: z.string().min(1).default("chat-cli-"),
  qdrantUrl: z.url().default("http://localhost:6333"),
  qdrantSparseModel: z.string().min(1).default("Qdrant/bm25"),
  chunkTokens: z.coerce.number().int().positive().default(512),
  chunkOverlap: z.coerce.number().int().nonnegative().default(64),
});

export type RagConfig = z.infer<typeof schema>;

/** Dense embedding dimension for text-embedding-3-small. */
export const DENSE_VECTOR_SIZE = 1536;

export function loadRagConfig(env: Record<string, string | undefined> = process.env): RagConfig {
  const config = schema.parse({
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    minioEndpoint: env.MINIO_ENDPOINT,
    minioAccessKey: env.MINIO_ACCESS_KEY,
    minioSecretKey: env.MINIO_SECRET_KEY,
    minioBucketPrefix: env.MINIO_BUCKET_PREFIX,
    qdrantUrl: env.QDRANT_URL,
    qdrantSparseModel: env.QDRANT_SPARSE_MODEL,
    chunkTokens: env.RAG_CHUNK_TOKENS,
    chunkOverlap: env.RAG_CHUNK_OVERLAP,
  });
  if (config.chunkOverlap >= config.chunkTokens) {
    throw new Error("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_TOKENS");
  }
  return config;
}
