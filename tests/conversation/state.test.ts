import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTokens, SessionState } from "../../src/conversation/state";
import { usage } from "../helpers/mock-openai";

let dir: string;
const stateFile = () => join(dir, "nested", "session.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chat-state-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 characters, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("SessionState persistence", () => {
  it("starts fresh when no file exists", () => {
    const state = SessionState.load(stateFile());
    expect(state.summary).toBe("");
    expect(state.facts).toEqual([]);
    expect(state.sources).toEqual([]);
    expect(state.report()).toContain("No turns recorded");
  });

  it("persists sources across reloads", () => {
    const state = SessionState.load(stateFile());
    expect(state.addSources(["src/a.ts", "src/b.ts"])).toEqual(["src/a.ts", "src/b.ts"]);
    expect(state.addSources(["src/b.ts", "src/c.ts"])).toEqual(["src/c.ts"]);

    const reloaded = SessionState.load(stateFile());
    expect(reloaded.sources).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("persists facts and summary across reloads (creating the dir)", () => {
    const state = SessionState.load(stateFile());
    state.addFact("likes tea");
    state.setSummary("discussed SSR");

    const reloaded = SessionState.load(stateFile());
    expect(reloaded.facts).toEqual(["likes tea"]);
    expect(reloaded.summary).toBe("discussed SSR");
  });

  it("recovers from a corrupt state file instead of throwing", () => {
    const path = stateFile();
    const state = SessionState.load(path);
    state.addFact("x"); // creates the file/dir
    // Corrupt it, then reload.
    rmSync(path);
    writeFileSync(path, "not json{");
    expect(() => SessionState.load(path)).not.toThrow();
    expect(SessionState.load(path).facts).toEqual([]);
  });
});

describe("SessionState token accounting", () => {
  it("accumulates response + summarizer usage and reports savings vs naive", () => {
    const state = SessionState.load(stateFile());

    state.growNaive("a".repeat(4000)); // ~1000 naive tokens
    const naiveInput = state.snapshotNaiveInput(0);
    state.addResponseUsage(
      usage({ input_tokens: 200, output_tokens: 50, input_tokens_details: { cached_tokens: 80 } }),
    );
    state.addSummarizerUsage(usage({ total_tokens: 30 }));
    state.finishTurn(naiveInput);

    const report = state.report();
    expect(report).toContain("Context report — 1 turn");
    expect(report).toContain("Input sent (actual):");
    expect(report).toMatch(/served from cache:\s+80 tok \(40%\)/);
    expect(report).toContain("Summarizer overhead:");
    // saved = baseline(1000) - (actualInput 200 + summarizer 30) = 770
    expect(report).toMatch(/Saved vs naive:\s+770 tok/);
  });

  it("ignores undefined usage payloads", () => {
    const state = SessionState.load(stateFile());
    expect(() => {
      state.addResponseUsage(undefined);
      state.addSummarizerUsage(undefined);
    }).not.toThrow();
  });

  it("serializes usage totals to disk", () => {
    const path = stateFile();
    const state = SessionState.load(path);
    state.addResponseUsage(usage({ input_tokens: 10, output_tokens: 5 }));
    state.finishTurn(100);

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.usage.actualInput).toBe(10);
    expect(persisted.usage.turns).toBe(1);
  });
});
