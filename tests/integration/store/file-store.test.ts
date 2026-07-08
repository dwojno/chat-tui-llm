import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileConversationStore } from "../../../src/integration/store/file-store";
import { EMPTY_USAGE } from "../../../src/integration/usage";
import type { PersistedState } from "../../../src/integration/store/types";

let dir: string;
const file = () => join(dir, "nested", "session.json");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chat-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sample: PersistedState = {
  summary: "discussed SSR",
  facts: ["likes tea"],
  sources: ["src/a.ts"],
  usage: { ...EMPTY_USAGE, turns: 3 },
};

describe("FileConversationStore", () => {
  it("returns null when no file exists", () => {
    expect(new FileConversationStore(file()).load()).toBeNull();
  });

  it("saves (creating the dir) and loads a round-trip", () => {
    const store = new FileConversationStore(file());
    store.save(sample);
    expect(store.load()).toEqual(sample);
    expect(JSON.parse(readFileSync(file(), "utf8")).usage.turns).toBe(3);
  });

  it("treats a corrupt file as absent instead of throwing", () => {
    const store = new FileConversationStore(file());
    store.save(sample); // creates the dir + file
    writeFileSync(file(), "not json{");
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toBeNull();
  });
});
