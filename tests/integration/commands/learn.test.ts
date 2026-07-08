import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../../../src/integration/commands/registry";
import type { CommandContext } from "../../../src/integration/commands/types";
import { AgentService } from "../../../src/agent/agent";
import { Session } from "../../../src/integration/session";
import type { ChatHandle } from "../../../src/ui/chat";
import { createMemoryStore, createMockOpenAI } from "../../helpers/mock-openai";

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
    const session = await Session.create(
      new AgentService(client),
      client,
      await createMemoryStore(),
      4,
    );
    const push = vi.fn();
    const ctx: CommandContext = {
      temperature: 0.5,
      session,
      chat: { push } as unknown as ChatHandle,
    };

    const action = await runCommand("/learn @note.txt @missing.txt", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(await session.sources()).toEqual(["note.txt"]);
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringMatching(
          /Added 1 source[\s\S]*note\.txt[\s\S]*Not found: @missing\.txt/,
        ),
      }),
    );
  });
});
