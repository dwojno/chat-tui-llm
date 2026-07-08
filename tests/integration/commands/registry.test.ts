import { describe, expect, it, vi } from "vitest";
import { ResponseSchema } from "../../../src/agent/tools/utils/schemas";
import type { Session } from "../../../src/integration/session";
import type { ChatHandle } from "../../../src/ui/chat";
import {
  resolveCommand,
  runCommand,
  slashCommandCatalog,
} from "../../../src/integration/commands/registry";
import type { CommandContext } from "../../../src/integration/commands/types";

function makeCtx(overrides: Partial<CommandContext> = {}) {
  const addFact = vi.fn();
  const addSources = vi.fn().mockReturnValue([]);
  const push = vi.fn();
  const ctx: CommandContext = {
    temperature: 0.5,
    session: {
      addFact,
      addSources,
      sources: [],
      ...overrides.session,
    } as unknown as Session,
    chat: { push, ...overrides.chat } as unknown as ChatHandle,
    ...overrides,
  };
  return { ctx, addFact, addSources, push };
}

describe("resolveCommand", () => {
  it.each([
    ["exit", "exit"],
    ["/remember something", "remember"],
    ["/learn", "learn"],
    ["/learn @src/foo.ts", "learn"],
    ["/sources", "sources"],
    ["/structured q", "structured"],
    ["/json q", "json"],
    ["just chatting", "chat"],
  ])("routes %j to the %s command", (input, name) => {
    expect(resolveCommand(input).name).toBe(name);
  });
});

describe("runCommand", () => {
  it("turns a plain line into a streaming turn with the resolved temperature", async () => {
    const { ctx } = makeCtx();
    const action = await runCommand("hello there", ctx);
    expect(action).toMatchObject({
      kind: "turn",
      content: "hello there",
      options: { temperature: 0.5, stream: true },
    });
  });

  it("exit stops the REPL", async () => {
    const { ctx } = makeCtx();
    expect(await runCommand("exit", ctx)).toEqual({ kind: "exit" });
  });

  it("/json strips the prefix and appends the JSON instruction", async () => {
    const { ctx } = makeCtx();
    const action = await runCommand("/json list primes", ctx);
    expect(action).toMatchObject({
      kind: "turn",
      content: "list primes\n\nRespond in JSON format.",
      options: { json_mode: true },
    });
  });

  it("/structured attaches the response schema", async () => {
    const { ctx } = makeCtx();
    const action = await runCommand("/structured who won?", ctx);
    expect(action).toMatchObject({ kind: "turn", content: "who won?" });
    expect((action as { options: { structured_output: unknown } }).options.structured_output).toBe(
      ResponseSchema,
    );
  });

  it("/remember pins the fact and echoes it, without a model turn", async () => {
    const { ctx, addFact, push } = makeCtx();
    const action = await runCommand("/remember I like tea", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(addFact).toHaveBeenCalledWith("I like tea");
    expect(push).toHaveBeenCalledTimes(2); // the user line + the confirmation
  });

  it("/remember with an empty fact is a no-op", async () => {
    const { ctx, addFact } = makeCtx();
    expect(await runCommand("/remember   ", ctx)).toEqual({ kind: "handled" });
    expect(addFact).not.toHaveBeenCalled();
  });

  it("/learn without @mentions shows usage", async () => {
    const { ctx, addSources, push } = makeCtx();
    const action = await runCommand("/learn", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(addSources).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Usage:"),
      }),
    );
  });

  it("/sources lists indexed files", async () => {
    const { ctx, push } = makeCtx({
      session: { sources: ["src/a.ts", "tests/b.ts"] } as unknown as Session,
    });
    const action = await runCommand("/sources", ctx);
    expect(action).toEqual({ kind: "handled" });
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringMatching(/src\/a\.ts[\s\S]*tests\/b\.ts/),
      }),
    );
  });
});

describe("slashCommandCatalog", () => {
  it("lists the user-typeable slash commands only", () => {
    const completions = slashCommandCatalog().map((c) => c.completion);
    expect(completions).toEqual(
      expect.arrayContaining(["/remember ", "/learn ", "/sources", "/structured ", "/json "]),
    );
    // `exit` and the `chat` fallback are not slash commands.
    expect(completions.some((c) => c.includes("exit") || c.includes("chat"))).toBe(false);
    expect(slashCommandCatalog().every((c) => c.hint.length > 0)).toBe(true);
  });
});
