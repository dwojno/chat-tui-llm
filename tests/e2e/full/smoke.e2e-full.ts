import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-live-"));

describe("TUI e2e (LIVE model): smoke", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it("answers a weather question by calling the tool", { timeout: 180_000 }, async () => {
    tui = spawnTui({ stateDir: newStateDir() });
    await tui.waitFor("Welcome to Chat CLI");
    await tui.submit("Use the get_weather_data tool for Paris, then tell me the weather.");
    await tui.waitFor("Fetching weather data", { timeout: 120_000 });
    expect(await tui.waitFor(/sunny|Paris/i, { timeout: 120_000 })).toMatch(/sunny|Paris/i);
  });
});
