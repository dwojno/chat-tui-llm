export { SourcesFacade } from "./source.facade";
export type {
  GrepMatch,
  GrepOptions,
  IndexResult,
  ReadRange,
  SearchHit,
  SearchOptions,
  Source,
  SourceProgress,
  SourceStatus,
} from "@chat/store";
export type { RagConfig } from "@/platform/config";
export { createRagDeps, type RagDeps } from "./rag/deps";
