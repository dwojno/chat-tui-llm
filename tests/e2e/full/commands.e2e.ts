import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));

describe("TUI e2e: commands", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("/remember pins a memory without a model turn", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("empty.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("/remember I like tea");
    await tui.waitFor(/Remember/i);
  });

  it("/structured renders answer plus sources", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("structured.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("/structured what is the answer?");
    await tui.waitFor("42");
    await tui.waitFor("Sources: s1");
  });
});
