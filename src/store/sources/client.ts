/** Source file paths pulled in via `/learn`, deduplicated per session. */
export abstract class SourcesClient {
  /** Insert new paths, skipping duplicates; returns the paths actually added. */
  abstract add(paths: readonly string[]): Promise<string[]>;
  abstract list(): Promise<string[]>;
}
