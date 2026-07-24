import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const turns = (name: string): string => join(process.cwd(), "apps/cli/tests/e2e/full/turns", name);
const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-"));

describe("TUI e2e: chat + tools", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("boots and renders the welcome + prompt", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("empty.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.waitFor("❯");
  });

  it("runs a tool call and streams the answer", async () => {
    tui = spawnTui({ stateDir: newStateDir(), turnsFile: turns("weather.json") });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("what is the weather in Paris?");
    await tui.waitFor("Fetching weather data");
    await tui.waitFor("sunny in Paris");
  });
});
