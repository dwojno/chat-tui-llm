import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readActiveState, writeActiveState } from "@/store/active-state";
import { DEFAULT_PROFILE_ID } from "@/store/profile/profile.repository";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "active-state-"));
  dbPath = join(dir, "chat.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("active-state", () => {
  it("round-trips profile + conversation as one JSON file", () => {
    writeActiveState(dbPath, { profileId: "work", conversationId: "conv-1" });
    expect(readActiveState(dbPath)).toEqual({ profileId: "work", conversationId: "conv-1" });
    // Stored as pretty JSON next to the db.
    expect(JSON.parse(readFileSync(join(dir, "active.json"), "utf8"))).toEqual({
      profileId: "work",
      conversationId: "conv-1",
    });
  });

  it("omits conversationId when absent", () => {
    writeActiveState(dbPath, { profileId: "solo" });
    expect(readActiveState(dbPath)).toEqual({ profileId: "solo" });
  });

  it("falls back to the default profile when the file is missing", () => {
    expect(readActiveState(dbPath)).toEqual({ profileId: DEFAULT_PROFILE_ID });
  });

  it("falls back to the default when the file is malformed", () => {
    writeFileSync(join(dir, "active.json"), "{ not json");
    expect(readActiveState(dbPath)).toEqual({ profileId: DEFAULT_PROFILE_ID });
  });

  it("ignores a non-string conversationId", () => {
    writeFileSync(join(dir, "active.json"), JSON.stringify({ profileId: "x", conversationId: 5 }));
    expect(readActiveState(dbPath)).toEqual({ profileId: "x" });
  });
});
