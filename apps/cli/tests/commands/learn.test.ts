import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands/registry";
import type { CommandContext } from "@/commands/types";
import type { ChatHandle } from "@/ui/chat";
import { createMemoryStore, createMockOpenAI } from "@tests/helpers/mock-openai";
import { createFakeRag } from "@tests/helpers/fake-rag";
import { testSession } from "@tests/helpers/agent";

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
    const { client } = createMockOpenAI();
    const { session } = await testSession(client, await createMemoryStore(createFakeRag().deps));
    const push = vi.fn();
    const ctx: CommandContext = {
      session,
      chat: { push } as unknown as ChatHandle,
      store: session.store,
    };

    const action = await runCommand("/learn @note.txt @missing.txt", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(await session.sources()).toEqual(["note.txt"]);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringMatching(
          /Indexed 1 source[\s\S]*note\.txt[\s\S]*Not found: @missing\.txt/,
        ),
      }),
    );
  });
});
