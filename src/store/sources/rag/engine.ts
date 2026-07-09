import assert from "node:assert";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { GrepMatch, GrepOptions, ReadRange, SearchHit, SourceProgress } from "../types";
import { chunkMarkdown, embedText } from "./chunking";
import type { RagConfig } from "./config";
import type { DenseEmbedder } from "./embeddings";
import type { ObjectStore } from "./blob";
import { toMarkdown } from "./markdown";
import type { ChunkPayload, VectorIndex, VectorPoint } from "./qdrant";

/**
 * RAG engine (internal to the `sources` domain): composes markdown conversion,
 * chunking, embedding, object storage and the vector index. Stateless w.r.t.
 * the SQLite `source` table — the facade owns row bookkeeping.
 */
export class RagEngine {
  constructor(
    private readonly config: RagConfig,
    private readonly embedder: DenseEmbedder,
    private readonly blob: ObjectStore,
    private readonly index: VectorIndex,
  ) {}

  s3KeyFor(path: string): string {
    return `${path.replace(/[^a-zA-Z0-9._/-]/g, "_")}.md`;
  }

  async *indexDocument(
    profileId: string,
    path: string,
    bytes: Buffer,
  ): AsyncGenerator<SourceProgress, { s3Key: string; contentHash: string; chunkCount: number }> {
    yield { message: `converting ${path}` };
    const markdown = await toMarkdown(path, bytes);
    const key = this.s3KeyFor(path);

    yield { message: "uploading to object storage" };
    await this.blob.ensureBucket(profileId);
    await this.blob.put(profileId, key, markdown);

    const chunks = chunkMarkdown(markdown, {
      chunkTokens: this.config.chunkTokens,
      chunkOverlap: this.config.chunkOverlap,
    });

    yield { message: `embedding ${chunks.length} chunks` };
    const dense = await this.embedder.embed(chunks.map(embedText));
    assert(dense.length === chunks.length, "embedding count mismatch");

    const points: VectorPoint[] = chunks.map((chunk, i) => {
      const vector = dense[i];
      assert(vector !== undefined);
      const payload: ChunkPayload = {
        path,
        chunkIndex: chunk.index,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        headingPath: chunk.headingPath,
        s3Key: key,
        text: chunk.content,
      };
      return {
        seed: `${profileId}:${path}:${chunk.index}`,
        dense: vector,
        text: embedText(chunk),
        payload,
      };
    });

    yield { message: "indexing vectors" };
    await this.index.ensureCollection(profileId);
    await this.index.deleteByPath(profileId, path); // drop stale chunks on re-index
    await this.index.upsert(profileId, points);

    const contentHash = createHash("sha256").update(bytes).digest("hex");
    return { s3Key: key, contentHash, chunkCount: chunks.length };
  }

  async search(profileId: string, query: string, limit: number): Promise<SearchHit[]> {
    const dense = await this.embedder.embed([query]);
    const vector = dense[0];
    assert(vector !== undefined, "query embedding missing");
    const results = await this.index.search(profileId, vector, query, limit);
    return results.map((result) => ({
      path: result.payload.path,
      startLine: result.payload.startLine,
      endLine: result.payload.endLine,
      score: result.score,
      snippet: truncate(result.payload.text, 320),
    }));
  }

  async *grep(
    profileId: string,
    files: { path: string; key: string }[],
    pattern: string,
    opts: GrepOptions,
  ): AsyncGenerator<GrepMatch, void> {
    const regex = compileRegex(pattern, opts.ignoreCase ?? false);
    const max = opts.maxMatches ?? 200;
    let count = 0;

    for (const file of files) {
      const stream = await this.blob.getStream(profileId, file.key);
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let lineNo = 0;
      for await (const line of rl) {
        lineNo++;
        if (regex.test(line)) {
          yield { path: file.path, line: lineNo, text: line };
          if (++count >= max) {
            rl.close();
            stream.destroy();
            return;
          }
        }
      }
      rl.close();
    }
  }

  async readFile(profileId: string, key: string, range: ReadRange): Promise<string> {
    if (range.kind === "bytes") {
      return this.blob.getRange(profileId, key, range.start, range.end);
    }
    const text = await this.blob.getText(profileId, key);
    const lines = text.split("\n");
    const start = Math.max(1, range.start);
    const end = Math.min(lines.length, range.end);
    return lines.slice(start - 1, end).join("\n");
  }

  async removeDocument(profileId: string, path: string, key: string): Promise<void> {
    await this.index.deleteByPath(profileId, path);
    await this.blob.remove(profileId, key);
  }
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function compileRegex(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? "i" : "");
  } catch {
    throw new Error(`Invalid grep pattern: ${pattern}`);
  }
}
