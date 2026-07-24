import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "apps/cli/tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));
const HANDBOOK = "apps/cli/tests/fixtures/rag-corpus/handbook.md";

describe("TUI e2e: RAG ingestion against real Qdrant", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("/learn indexes a file and /sources lists it", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("empty.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit(`/learn @${HANDBOOK} `);
    await tui.waitFor(/Indexed \d+ source|Failed to index|Not found/i, { timeout: 90_000 });
    await tui.submit("/sources");
    await tui.waitFor("handbook.md");
  });
});
