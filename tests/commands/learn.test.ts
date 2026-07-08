import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../../src/commands/registry";
import type { CommandContext } from "../../src/commands/types";
import { SessionState } from "../../src/conversation/state";
import type { ChatHandle } from "../../src/ui/chat";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "learn-cmd-"));
  process.chdir(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("learn command", () => {
  it("indexes valid @files and reports missing ones", async () => {
    writeFileSync("note.txt", "hello");
    const state = SessionState.load(join(dir, "session.json"));
    const push = vi.fn();
    const ctx: CommandContext = {
      temperature: 0.5,
      state,
      chat: { push } as unknown as ChatHandle,
    };

    const action = await runCommand("/learn @note.txt @missing.txt", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(state.sources).toEqual(["note.txt"]);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringMatching(/Added 1 source[\s\S]*note\.txt[\s\S]*Not found: @missing\.txt/),
      }),
    );
  });
});
