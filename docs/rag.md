# Retrieval-Augmented Generation

The knowledge base is a hand-built RAG pipeline — ingest, hybrid retrieval,
rerank, and citable slicing — that lives **entirely inside the `sources` store
domain** ([src/store/sources/](../src/store/sources/)). The agent core never
learns it exists: RAG reaches the model only as four store-backed tools, exactly
like any other tool (see [agent-loop.md](./agent-loop.md#tools-are-streams)). This
is the authoritative reference for how documents are indexed, how a query is
answered, and how the infrastructure is laid out. For the loop and delegation see
[agent-loop.md](./agent-loop.md); for the layering see
[architecture.md](./architecture.md).

## Where it sits

```
src/store/sources/
  source.facade.ts    the domain's public API (store.sources.*) — the only surface
  source.repository.ts SQLite bookkeeping: one row per indexed file, per profile
  rag/
    engine.ts         orchestrates convert → chunk → embed → index, and search()
    markdown.ts       any supported file type → Markdown
    chunking.ts       heading-aware, line-tracked chunker
    embeddings.ts     OpenAI dense embedder (+ a BM25-lite fallback for tests)
    qdrant.ts         per-profile vector index (dense + sparse, RRF fusion)
    blob.ts           per-profile object storage (MinIO/S3)
    reranker.ts       LLM relevance reranker (swappable)
    config.ts         env-driven knobs
    deps.ts           assembles the engine from an OpenAI client + config
```

The facade (`SqliteSourcesFacade`) is the boundary. It owns the SQLite `source`
rows (path, status, `s3Key`, `contentHash`, `chunkCount`) and delegates all
retrieval work to the `RagEngine`, which is **stateless w.r.t. that table** — it
touches only the object store and the vector index. `createRagDeps(openai,
config)` ([deps.ts](../src/store/sources/rag/deps.ts)) wires the concrete infra
clients (embedder, blob, index, reranker) into the engine, so the facade never
holds an S3 or Qdrant client directly. When the infra env vars are unset the
facade is constructed without `deps` and every RAG call throws a friendly
"Knowledge base is not configured" message.

**Everything is per-profile.** Each profile gets its own MinIO bucket
(`${prefix}${profileId}`) and its own Qdrant collection (`kb_${profileId}`), so
one profile's sources never leak into another's retrieval. Switching profiles
switches knowledge bases.

## Ingest (`/learn @file`)

`/learn @file` ([commands/learn.ts](../src/integration/commands/learn.ts)) resolves
the mention, then streams `session.indexSource(path)` →
`facade.add` → `engine.indexDocument`
([engine.ts](../src/store/sources/rag/engine.ts)). One document flows through:

1. **Convert to Markdown** (`toMarkdown`,
   [markdown.ts](../src/store/sources/rag/markdown.ts)). By extension: `md`
   passthrough; `html`/`docx` via Turndown (docx first through mammoth); `pdf` via
   unpdf text extraction; `xlsx`/`xls`/`csv` rendered as Markdown tables (one
   `## sheet` heading per worksheet); any other UTF-8 text or source file is
   fenced with a language hint (`.ts` → ` ```typescript `). A file that
   looks binary (a NUL byte in the first 8 KB) throws rather than indexing garbage.
2. **Upload** the Markdown to the profile's object-storage bucket under a
   sanitized key (`s3KeyFor(path)` → `<path>.md`). The raw text is kept so
   `grep_files` and `read_file` can stream/slice it later without re-fetching the
   original.
3. **Chunk** (`chunkMarkdown`, [chunking.ts](../src/store/sources/rag/chunking.ts)).
   Split on Markdown headings, then pack each section's lines into ~`chunkTokens`
   (512) windows with ~`chunkOverlap` (64) token overlap. Every chunk carries its
   **heading breadcrumb** (`Guide > Setup > Auth`) and its **1-based line range**
   in the converted Markdown. That line range is what lets a hit cite
   `path:startLine-endLine` and lets `read_file` slice the exact region. The
   chunker is deterministic and unit-tested.
4. **Embed.** The chunk's embedding input is `headingPath + "\n\n" + content`
   (`embedText`) — the breadcrumb gives an otherwise-context-free chunk its place
   in the document. Dense vectors come from OpenAI
   (`text-embedding-3-small`, 1536-dim) in batches of 64
   ([embeddings.ts](../src/store/sources/rag/embeddings.ts)).
5. **Upsert** into the profile's Qdrant collection
   ([qdrant.ts](../src/store/sources/rag/qdrant.ts)). Each point gets a
   deterministic id derived from `profileId:path:chunkIndex`, so re-indexing the
   same file overwrites cleanly; stale chunks for that path are deleted first. The
   dense vector is stored directly; the **sparse** vector is produced by Qdrant
   **server-side inference** (`QDRANT_SPARSE_MODEL`, e.g. `Qdrant/bm25`) from the
   chunk text — the app sends text, Qdrant embeds it.

On success the facade records `status: "indexed"`, the `s3Key`, a `sha256`
content hash, and the chunk count on the SQLite row. On any failure the row is
marked `status: "error"` and the turn continues (the error text is surfaced to
the user, not thrown).

`/reindex` re-runs ingest for every file in the profile;
`session.removeSource` / `facade.reset` drop a single file or wipe the whole
knowledge base (Qdrant collection + bucket), the latter also used by the evals to
guarantee a fresh, isolated index per run.

## Retrieval (`search()`)

Raw hybrid search alone over-serves the agent — it returns the top-N hits
regardless of how relevant each one actually is ("gets all the things"). So
`engine.search()` is a **four-stage pipeline**:

1. **Hybrid fetch.** Qdrant's Query API runs a dense (embedding) prefetch and a
   sparse (BM25) prefetch, each over `limit × 2` candidates, and fuses them with
   **RRF** (Reciprocal Rank Fusion). RRF is recall-first: it merges the two
   rankings well but its fused scores sit in a narrow rank-reciprocal band with no
   meaningful absolute scale, so you can't threshold on them.
2. **Rerank.** With reranking on, `search()` over-fetches a larger candidate pool
   (`limit × RAG_RERANK_CANDIDATE_MULTIPLIER`, capped at
   `RAG_RERANK_MAX_CANDIDATES`) and hands it to a **`Reranker`**
   ([reranker.ts](../src/store/sources/rag/reranker.ts)). The default
   `LlmReranker` makes one structured-output call that scores each candidate 0–1
   for true relevance, returns them most-relevant-first, and **omits off-topic
   ones**. Two safety properties:
   - It returns **indices only** — the engine keeps the authoritative Qdrant
     results and merely reorders them, so the model can never fabricate chunk
     content through the reranker.
   - It **must not throw** — every failure path (API error, empty/unparseable
     ranking, nothing to prune) degrades to the fused order. A search never fails
     because reranking did.

   `Reranker` is an interface, so a Cohere/cross-encoder implementation is a
   one-line swap in [deps.ts](../src/store/sources/rag/deps.ts).

3. **Relative filter** (`applyRelativeCutoff`). Because rerank scores now have real
   0–1 spread, drop any hit below `RAG_RELATIVE_CUTOFF × topScore`. The cutoff is
   **relative to this query's own best hit** — a good match for a broad query can
   score lower than a weak match for a precise one, so an absolute threshold would
   misfire. The top hit always survives, so a real match never filters to nothing.
4. **Return whole.** Surviving hits are returned with their heading breadcrumb and
   the full chunk body (capped at `RAG_SNIPPET_MAX_CHARS` ≈ 1200 chars ≈ a whole
   512-token chunk), not a mid-sentence stub. Grounding is better with fewer,
   complete passages.

Setting `RAG_RERANK_ENABLED=false` skips stages 2–3 and keeps the RRF top-N as-is
— a clean pure-hybrid baseline (the relative cutoff is deliberately _not_ applied
to raw RRF scores, since they have no absolute scale).

## The tools

Composed in `createRagTools(store)`
([integration/rag/tools.ts](../src/integration/rag/tools.ts)) and injected into
the agent; each closes over the live `Store` and calls `store.sources.*` for the
**active profile**.

| Tool                    | Purpose                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_knowledge_base` | Hybrid + reranked semantic search. Returns `path:startLine-endLine (score)` + snippet per hit. `limit` defaults to 8; the model is told to raise it only when top results miss.           |
| `list_files`            | The indexed files in the current profile.                                                                                                                                                 |
| `grep_files`            | Regex over the raw Markdown (streamed line-by-line from object storage), returning `path:line: text`. For exact strings/identifiers/errors. Streams `status` events as matches are found. |
| `read_file`             | Read a line range (or byte range) of an indexed file — used to expand a truncated hit into its full context.                                                                              |

The tool descriptions steer usage: focused queries over broad ones,
`search_knowledge_base` for concepts vs `grep_files` for exact strings, and
`read_file` to expand a promising-but-cut-off hit rather than searching again.

## Multi-hop retrieval

One-shot lookups call these tools directly from the main orchestrator turn.
**Multi-hop** retrieval — chained searches where a fact from one passage guides
the next lookup — is delegated to the **`rag_research` fork profile**, which
carries exactly this tool set and the `RAG_FORK_INSTRUCTIONS` prompt
([prompts/rag-fork.ts](../src/agent/prompts/rag-fork.ts)). The fork works
iteratively (refine query → grep → read slice → repeat), then its transcript is
compressed into a structured `ForkResult` so exact values (numbers, paths, ids)
survive the handoff verbatim. See
[agent-loop.md](./agent-loop.md#fork-profiles).

## Configuration

Knobs live in [config.ts](../src/store/sources/rag/config.ts), parsed from the
environment (defaults in [.env.example](../.env.example)). Parsing is separated
from `process.env` so tests pass an explicit env map.

| Env var                                          | Default                         | Meaning                                             |
| ------------------------------------------------ | ------------------------------- | --------------------------------------------------- |
| `OPENAI_EMBEDDING_MODEL`                         | `text-embedding-3-small`        | Dense embedding model (1536-dim).                   |
| `MINIO_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` | `localhost:9000` / `minioadmin` | Object storage connection.                          |
| `MINIO_BUCKET_PREFIX`                            | `chat-cli-`                     | Per-profile bucket = `${prefix}${profileId}`.       |
| `QDRANT_URL`                                     | `localhost:6333`                | Vector DB connection.                               |
| `QDRANT_SPARSE_MODEL`                            | `Qdrant/bm25`                   | Server-side sparse-vector inference model.          |
| `RAG_CHUNK_TOKENS`                               | `512`                           | Target chunk size.                                  |
| `RAG_CHUNK_OVERLAP`                              | `64`                            | Token overlap between chunks (must be `<` tokens).  |
| `RAG_RERANK_ENABLED`                             | `true`                          | `false` → pure-RRF baseline (skips stages 2–3).     |
| `RAG_RERANK_MODEL`                               | `gpt-4o-mini`                   | Reranker LLM.                                       |
| `RAG_RERANK_CANDIDATE_MULTIPLIER`                | `3`                             | Over-fetch `limit × this` candidates to rerank.     |
| `RAG_RERANK_MAX_CANDIDATES`                      | `24`                            | Absolute cap on the candidate pool.                 |
| `RAG_RELATIVE_CUTOFF`                            | `0.5`                           | Drop hits below this fraction of the top relevance. |
| `RAG_SNIPPET_MAX_CHARS`                          | `1200`                          | Per-hit snippet cap (≈ a full chunk).               |

## Running it

The infra is two containers ([docker-compose.yml](../docker-compose.yml)):

```bash
docker compose up -d          # MinIO (:9000/:9001) + Qdrant (:6333)
# in the CLI:
/learn @docs/architecture.md  # convert → chunk → embed → index
/sources                      # list indexed files
/reindex                      # re-index everything for this profile
```

With the containers down or the env vars unset, RAG calls fail gracefully with
the "not configured" message; the rest of the agent is unaffected.

## Evals

Retrieval quality is measured end-to-end against the **real** pipeline — no mocks.
The RAG harness ([evals/harness/rag.ts](../evals/harness/rag.ts)) runs the app's
actual `AgentService` with the real store-backed tools over a fixed corpus in an
isolated `eval-<suiteId>` profile, and captures `retrievedContext` from the
agent's genuine tool outputs. The scorers
([evals/harness/scorers/rag-scorers.ts](../evals/harness/scorers/rag-scorers.ts))
combine RAGAS-style metrics from `autoevals` (Faithfulness, Context Precision,
Answer Relevancy, Context Relevancy) with hand-rolled file-level ones:

- **Context Recall** — of the gold source files, how many did the agent retrieve?
- **Retrieval Precision** — of the files retrieved, how many were gold? This
  penalises the over-retrieval the rerank+filter stages exist to prevent.
- **Retrieval F1** — the harmonic mean of the two.
- **Citation Recall / Citation Grounding** — did the answer cite the gold files,
  and is every citation backed by a file actually retrieved (no fabrication)?
- **Admits Insufficient** — on an unanswerable query, does the answer decline
  instead of hallucinating?

So a change to chunking, reranking, or the cutoff is provable as _tighter context
without dropping what the answer needs_. See the [evals suite](../evals/suites/rag-eval.eval.ts).
