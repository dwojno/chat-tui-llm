import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

type Env = Record<string, string | undefined>;

const APP_NAME = "chat-cli";
const STATE_DIR = ".chat-state";
const SOURCES_DIR = "sources";

const DEFAULTS = {
  embeddingModel: "text-embedding-3-small",
  blobBackend: "disk",
  minioEndpoint: "http://localhost:9000",
  minioCredential: "minioadmin",
  bucketPrefix: `${APP_NAME}-`,
  qdrantUrl: "http://localhost:6333",
  qdrantSparseModel: "Qdrant/bm25",
  chunkTokens: 512,
  chunkOverlap: 64,
  rerankModel: "gpt-4.1-nano",
  rerankCandidateMultiplier: 3,
  rerankMaxCandidates: 24,
  rerankRelativeCutoff: 0.5,
  snippetMaxChars: 1200,
  webSearchMaxResults: 5,
  otelEndpoint: "http://localhost:3000/api/public/otel",
  otelServiceName: APP_NAME,
} as const;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parseHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!value) return headers;
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    if (key) headers[key] = pair.slice(eq + 1).trim();
  }
  return headers;
}

function resolveBlobDir(env: Env): string {
  const override = env.CHAT_CLI_STATE_DIR;
  if (override) return join(override, SOURCES_DIR);
  if (env.NODE_ENV !== "production") return join(STATE_DIR, SOURCES_DIR);
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME, SOURCES_DIR);
  }
  if (process.platform === "win32") {
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_NAME, SOURCES_DIR);
  }
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_NAME, SOURCES_DIR);
}

function telemetryInput(env: Env) {
  return {
    enabled: parseBool(env.OTEL_ENABLED, false),
    captureContent: parseBool(env.OTEL_CAPTURE_CONTENT, true),
    redactPii: parseBool(env.REDACT_PII, true),
    endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    serviceName: env.OTEL_SERVICE_NAME,
  };
}

const modelSchema = z.object({ apiKey: z.string().min(1) });

const telemetrySchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false), captureContent: z.boolean(), redactPii: z.boolean() }),
  z.object({
    enabled: z.literal(true),
    captureContent: z.boolean(),
    redactPii: z.boolean(),
    endpoint: z.string().default(DEFAULTS.otelEndpoint),
    headers: z.record(z.string(), z.string()),
    serviceName: z.string().default(DEFAULTS.otelServiceName),
  }),
]);

const ragSchema = z
  .object({
    openaiEmbeddingModel: z.string().min(1).default(DEFAULTS.embeddingModel),
    blobBackend: z.enum(["disk", "s3"]).default(DEFAULTS.blobBackend),
    blobDir: z.string().min(1),
    minioEndpoint: z.url().default(DEFAULTS.minioEndpoint),
    minioAccessKey: z.string().min(1).default(DEFAULTS.minioCredential),
    minioSecretKey: z.string().min(1).default(DEFAULTS.minioCredential),
    minioBucketPrefix: z.string().min(1).default(DEFAULTS.bucketPrefix),
    qdrantUrl: z.url().default(DEFAULTS.qdrantUrl),
    qdrantSparseModel: z.string().min(1).default(DEFAULTS.qdrantSparseModel),
    chunkTokens: z.coerce.number().int().positive().default(DEFAULTS.chunkTokens),
    chunkOverlap: z.coerce.number().int().nonnegative().default(DEFAULTS.chunkOverlap),
    rerankEnabled: z.boolean(),
    rerankModel: z.string().min(1).default(DEFAULTS.rerankModel),
    rerankCandidateMultiplier: z.coerce
      .number()
      .int()
      .positive()
      .default(DEFAULTS.rerankCandidateMultiplier),
    rerankMaxCandidates: z.coerce.number().int().positive().default(DEFAULTS.rerankMaxCandidates),
    rerankRelativeCutoff: z.coerce.number().min(0).max(1).default(DEFAULTS.rerankRelativeCutoff),
    snippetMaxChars: z.coerce.number().int().positive().default(DEFAULTS.snippetMaxChars),
  })
  .refine((v) => v.chunkOverlap < v.chunkTokens, {
    path: ["chunkOverlap"],
    message: "RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_TOKENS",
  });

const toolsSchema = z.object({
  webSearch: z.object({
    maxResults: z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : v),
      z.coerce.number().int().positive().default(DEFAULTS.webSearchMaxResults),
    ),
    tavilyApiKey: z.string().min(1).optional(),
  }),
});

const securitySchema = z.object({ redactPii: z.boolean(), approvalsEnabled: z.boolean() });

const configSchema = z.preprocess(
  (raw) => {
    const env = (raw ?? {}) as Env;
    return {
      model: { apiKey: env.OPENAI_API_KEY },
      rag: {
        openaiEmbeddingModel: env.OPENAI_EMBEDDING_MODEL,
        blobBackend: env.RAG_BLOB_BACKEND,
        blobDir: env.RAG_BLOB_DIR ?? resolveBlobDir(env),
        minioEndpoint: env.MINIO_ENDPOINT,
        minioAccessKey: env.MINIO_ACCESS_KEY,
        minioSecretKey: env.MINIO_SECRET_KEY,
        minioBucketPrefix: env.MINIO_BUCKET_PREFIX,
        qdrantUrl: env.QDRANT_URL,
        qdrantSparseModel: env.QDRANT_SPARSE_MODEL,
        chunkTokens: env.RAG_CHUNK_TOKENS,
        chunkOverlap: env.RAG_CHUNK_OVERLAP,
        rerankEnabled: parseBool(env.RAG_RERANK_ENABLED, true),
        rerankModel: env.RAG_RERANK_MODEL,
        rerankCandidateMultiplier: env.RAG_RERANK_CANDIDATE_MULTIPLIER,
        rerankMaxCandidates: env.RAG_RERANK_MAX_CANDIDATES,
        rerankRelativeCutoff: env.RAG_RELATIVE_CUTOFF,
        snippetMaxChars: env.RAG_SNIPPET_MAX_CHARS,
      },
      telemetry: telemetryInput(env),
      tools: {
        webSearch: {
          maxResults: env.WEB_SEARCH_MAX_RESULTS,
          tavilyApiKey: env.TAVILY_API_KEY || undefined,
        },
      },
      security: {
        redactPii: parseBool(env.REDACT_PII, true),
        approvalsEnabled: !parseBool(env.CHAT_APPROVALS_DISABLED, false),
      },
    };
  },
  z.object({
    model: modelSchema,
    rag: ragSchema,
    telemetry: telemetrySchema,
    tools: toolsSchema,
    security: securitySchema,
  }),
);

export type EnvConfig = z.infer<typeof configSchema>;
export type RagConfig = EnvConfig["rag"];

export function loadConfig(env: Env = process.env): EnvConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
  }
  return result.data;
}

export const envConfig = loadConfig();
