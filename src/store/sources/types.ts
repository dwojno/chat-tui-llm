/**
 * Public result types for the `sources` domain RAG API. These are the shapes
 * the integration-layer tools consume via `store.sources.*` — the only surface
 * exposed outside the domain.
 */

export interface SearchHit {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepOptions {
  /** Restrict to these source paths (default: all indexed files). */
  paths?: string[];
  ignoreCase?: boolean;
  maxMatches?: number;
}

export type ReadRange =
  | { kind: "lines"; start: number; end: number }
  | { kind: "bytes"; start: number; end: number };

export interface SearchOptions {
  limit?: number;
}

/** A progress step yielded by streaming operations (indexing) for the UI. */
export interface SourceProgress {
  message: string;
}

export interface IndexResult {
  path: string;
  chunkCount: number;
  status: "indexed" | "error";
  error?: string;
}
