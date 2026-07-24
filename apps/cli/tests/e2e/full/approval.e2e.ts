import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "apps/cli/tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));
const outFile = (name: string): string => join(process.cwd(), ".chat-state/e2e", name);

describe("TUI e2e: approval gate", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
    rmSync(join(process.cwd(), ".chat-state/e2e"), { recursive: true, force: true });
  });

  it("writes the file after the user approves", async () => {
    rmSync(outFile("approved.txt"), { force: true });
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("approve.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("save an approved note");
    await tui.approve();
    await tui.waitFor("Saved the file");
    expect(existsSync(outFile("approved.txt"))).toBe(true);
  });

  it("does not write the file when the user rejects", async () => {
    rmSync(outFile("denied.txt"), { force: true });
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("deny.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("save a note i will reject");
    await tui.deny();
    await tui.waitFor(/Rejected|will not write/i);
    expect(existsSync(outFile("denied.txt"))).toBe(false);
  });
});
