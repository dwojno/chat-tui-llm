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

export interface SourceProgress {
  message: string;
}

export interface IndexResult {
  path: string;
  chunkCount: number;
  status: "indexed" | "error";
  error?: string;
}
