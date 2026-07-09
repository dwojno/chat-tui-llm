import assert from "node:assert";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import type { GrepMatch, GrepOptions, ReadRange, SearchHit, SourceProgress } from "../types";
import { chunkMarkdown, embedText } from "./chunking";
import type { RagConfig } from "./config";
import type { DenseEmbedder } from "./embeddings";
import type { ObjectStore } from "./blob";
import { toMarkdown } from "./markdown";
import type { ChunkPayload, SearchResult, VectorIndex, VectorPoint } from "./qdrant";
import type { RerankCandidate, Reranker } from "./reranker";

/** A retrieval result paired with the score used for ranking/filtering it. */
interface ScoredResult {
  result: SearchResult;
  score: number;
}

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
    private readonly reranker: Reranker,
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

  /**
   * Hybrid search, then rerank + relevance-filter down to the most relevant
   * passages. With reranking on we over-fetch a larger candidate pool
   * (`limit * multiplier`, capped), have the reranker rescore it against the
   * query, drop hits below a fraction of the top relevance, and keep `limit`.
   * This is what turns "top-N regardless of relevance" into "only what's
   * actually relevant". Reranking degrades gracefully (fused order) on failure.
   */
  async search(profileId: string, query: string, limit: number): Promise<SearchHit[]> {
    const dense = await this.embedder.embed([query]);
    const vector = dense[0];
    assert(vector !== undefined, "query embedding missing");

    const candidateCount = this.config.rerankEnabled
      ? Math.min(limit * this.config.rerankCandidateMultiplier, this.config.rerankMaxCandidates)
      : limit;
    const results = await this.index.search(profileId, vector, query, candidateCount);
    if (!results.length) return [];

    // Rerank produces 0..1 relevance scores with real spread, so the relative
    // cutoff is meaningful. Without reranking we keep the RRF top-N as-is: RRF
    // scores sit in a narrow rank-reciprocal band, so a relative cutoff on them
    // is unreliable — leaving it off also makes this a clean RRF-only baseline.
    const ranked = this.config.rerankEnabled
      ? this.applyRelativeCutoff(await this.rerank(query, results, limit), limit)
      : results.slice(0, limit).map((result) => ({ result, score: result.score }));

    return ranked.map(({ result, score }) => ({
      path: result.payload.path,
      startLine: result.payload.startLine,
      endLine: result.payload.endLine,
      score,
      snippet: this.snippetFor(result.payload),
    }));
  }

  /**
   * Rerank the fused candidates by true relevance to the query. Returns hits in
   * descending relevance with a 0..1 `score` (the reranker's relevance, which
   * replaces the RRF score — a meaningful signal the relative filter can use).
   */
  private async rerank(
    query: string,
    results: SearchResult[],
    limit: number,
  ): Promise<ScoredResult[]> {
    const candidates: RerankCandidate[] = results.map((result, index) => ({
      index,
      text: result.payload.headingPath
        ? `${result.payload.headingPath}\n\n${result.payload.text}`
        : result.payload.text,
    }));
    const hits = await this.reranker.rerank(query, candidates, limit);
    return hits.flatMap((hit) => {
      const result = results[hit.index];
      return result ? [{ result, score: hit.relevance }] : [];
    });
  }

  /**
   * Drop reranked hits scoring below `rerankRelativeCutoff` of the top hit, then
   * keep at most `limit`. Relative to this query's own best hit rather than an
   * absolute threshold, since a good match for a broad query can still score
   * lower than a weak match for a precise one. Always keeps at least the top hit
   * so a match never filters down to nothing.
   */
  private applyRelativeCutoff(ranked: ScoredResult[], limit: number): ScoredResult[] {
    if (!ranked.length) return ranked;
    const top = ranked[0];
    assert(top !== undefined);
    const floor = top.score * this.config.rerankRelativeCutoff;
    const kept = ranked.filter((hit, i) => i === 0 || hit.score >= floor);
    return kept.slice(0, limit);
  }

  /** Display text for a hit: heading breadcrumb + chunk body, capped generously. */
  private snippetFor(payload: ChunkPayload): string {
    const body = truncate(payload.text, this.config.snippetMaxChars);
    return payload.headingPath ? `${payload.headingPath}\n${body}` : body;
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

  /**
   * Wipe a profile's knowledge base: drop its Qdrant collection and clear every
   * object in its bucket. Used to start an index over from scratch (and by the
   * evals to guarantee a fresh, isolated index per run). SQLite bookkeeping is
   * the facade's concern — this only touches the vector + object stores.
   */
  async reset(profileId: string): Promise<void> {
    await this.index.dropCollection(profileId);
    try {
      const keys = await this.blob.list(profileId);
      await Promise.all(keys.map((key) => this.blob.remove(profileId, key)));
    } catch {
      // Bucket may not exist yet — nothing to clear.
    }
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
