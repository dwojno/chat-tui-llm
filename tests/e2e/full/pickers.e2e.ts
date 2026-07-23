import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { spawnTui, KEY, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));

describe("TUI e2e: picker + prompt overlays", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("/profile creates a new profile and switches to it", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("empty.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("/profile");
    await tui.waitFor("Select Profile");
    tui.press("n");
    await tui.waitIdle();
    tui.press(KEY.enter);
    await tui.waitFor("Profile name");
    await tui.type("Work");
    tui.press(KEY.enter);
    await tui.waitFor('Switched to profile "Work"');
  });

  it("/conversation opens the picker and cancels on Esc", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("empty.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("/conversation");
    await tui.waitFor(/Conversation|Select/i);
    tui.press(KEY.esc);
    await tui.waitFor("❯");
  });
});
