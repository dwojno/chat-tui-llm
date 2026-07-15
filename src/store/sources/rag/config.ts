import { z } from "zod";
import { defaultBlobDir } from "./paths";

const schema = z.object({
  openaiEmbeddingModel: z.string().min(1).default("text-embedding-3-small"),
  blobBackend: z.enum(["disk", "s3"]).default("disk"),
  blobDir: z.string().min(1).default(defaultBlobDir()),
  minioEndpoint: z.url().default("http://localhost:9000"),
  minioAccessKey: z.string().min(1).default("minioadmin"),
  minioSecretKey: z.string().min(1).default("minioadmin"),
  minioBucketPrefix: z.string().min(1).default("chat-cli-"),
  qdrantUrl: z.url().default("http://localhost:6333"),
  qdrantSparseModel: z.string().min(1).default("Qdrant/bm25"),
  chunkTokens: z.coerce.number().int().positive().default(512),
  chunkOverlap: z.coerce.number().int().nonnegative().default(64),
  rerankEnabled: z.boolean().default(true),
  rerankModel: z.string().min(1).default("gpt-4.1-nano"),
  rerankCandidateMultiplier: z.coerce.number().int().positive().default(3),
  rerankMaxCandidates: z.coerce.number().int().positive().default(24),
  rerankRelativeCutoff: z.coerce.number().min(0).max(1).default(0.5),
  snippetMaxChars: z.coerce.number().int().positive().default(1200),
});

export type RagConfig = z.infer<typeof schema>;

export const DENSE_VECTOR_SIZE = 1536;

export function loadRagConfig(env: Record<string, string | undefined> = process.env): RagConfig {
  const config = schema.parse({
    openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
    blobBackend: env.RAG_BLOB_BACKEND,
    blobDir: env.RAG_BLOB_DIR,
    minioEndpoint: env.MINIO_ENDPOINT,
    minioAccessKey: env.MINIO_ACCESS_KEY,
    minioSecretKey: env.MINIO_SECRET_KEY,
    minioBucketPrefix: env.MINIO_BUCKET_PREFIX,
    qdrantUrl: env.QDRANT_URL,
    qdrantSparseModel: env.QDRANT_SPARSE_MODEL,
    chunkTokens: env.RAG_CHUNK_TOKENS,
    chunkOverlap: env.RAG_CHUNK_OVERLAP,
    rerankEnabled:
      env.RAG_RERANK_ENABLED === undefined ? undefined : env.RAG_RERANK_ENABLED !== "false",
    rerankModel: env.RAG_RERANK_MODEL,
    rerankCandidateMultiplier: env.RAG_RERANK_CANDIDATE_MULTIPLIER,
    rerankMaxCandidates: env.RAG_RERANK_MAX_CANDIDATES,
    rerankRelativeCutoff: env.RAG_RELATIVE_CUTOFF,
    snippetMaxChars: env.RAG_SNIPPET_MAX_CHARS,
  });
  if (config.chunkOverlap >= config.chunkTokens) {
    throw new Error("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_TOKENS");
  }
  return config;
}
