import { describe, expect, it, vi } from "vitest";
import { ResponseSchema } from "../../src/conversation/schemas";
import type { SessionState } from "../../src/conversation/state";
import type { ChatHandle } from "../../src/ui/chat";
import { resolveCommand, runCommand, slashCommandCatalog } from "../../src/commands/registry";
import type { CommandContext } from "../../src/commands/types";

function makeCtx() {
  const addFact = vi.fn();
  const push = vi.fn();
  const ctx: CommandContext = {
    temperature: 0.5,
    state: { addFact } as unknown as SessionState,
    chat: { push } as unknown as ChatHandle,
  };
  return { ctx, addFact, push };
}

describe("resolveCommand", () => {
  it.each([
    ["exit", "exit"],
    ["/remember something", "remember"],
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
});

describe("slashCommandCatalog", () => {
  it("lists the user-typeable slash commands only", () => {
    const completions = slashCommandCatalog().map((c) => c.completion);
    expect(completions).toEqual(expect.arrayContaining(["/remember ", "/structured ", "/json "]));
    // `exit` and the `chat` fallback are not slash commands.
    expect(completions.some((c) => c.includes("exit") || c.includes("chat"))).toBe(false);
    expect(slashCommandCatalog().every((c) => c.hint.length > 0)).toBe(true);
  });
});
