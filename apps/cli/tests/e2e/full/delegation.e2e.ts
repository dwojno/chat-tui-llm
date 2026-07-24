import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "apps/cli/tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));

describe("TUI e2e: delegation", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("delegates to a sub-agent and surfaces its tool activity", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("delegate.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("research the weather in Paris for me");
    await tui.waitFor("Fetching weather data");
    await tui.waitFor("Delegation complete");
  });
});
