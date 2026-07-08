import { describe, expect, it, vi } from "vitest";

// Drive the ChatHandle state machine headlessly: replace Ink's real render
// (raw-mode stdin, timers, ANSI) with a no-op so we can assert on the committed
// message list — the logic that must survive streaming, steps, and commits.
vi.mock("ink", () => ({
  render: () => ({
    rerender: vi.fn(),
    unmount: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: () => Promise.resolve(),
  }),
  Box: (props: { children?: unknown }) => props.children,
  Text: (props: { children?: unknown }) => props.children,
  Static: () => null,
  useInput: () => {},
}));

import { renderChat } from "../../src/ui/chat";

describe("renderChat handle", () => {
  it("appends completed messages", () => {
    const chat = renderChat([], { interactive: false });
    chat.push({ role: "user", content: "hi" });
    expect(chat.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("accumulates streamed deltas and commits them as an assistant message", () => {
    const chat = renderChat();
    chat.setStreaming("");
    chat.appendStreaming("Hel");
    chat.appendStreaming("lo");
    chat.commitStreaming();
    expect(chat.messages.at(-1)).toEqual({ role: "assistant", content: "Hello", steps: undefined });
  });

  it("preserves the thinking-step trace on the committed message", () => {
    const chat = renderChat();
    chat.setStreaming("");
    chat.addStep({ label: "Fetching weather data", detail: "Paris" });
    chat.addStep({ label: "Searching the web", fork: "Research" });
    chat.appendStreaming("done");
    chat.commitStreaming();

    expect(chat.messages.at(-1)).toEqual({
      role: "assistant",
      content: "done",
      steps: [
        { label: "Fetching weather data", detail: "Paris" },
        { label: "Searching the web", fork: "Research" },
      ],
    });
  });

  it("setStreaming opens a fresh bubble, clearing a prior step trace", () => {
    const chat = renderChat();
    chat.setStreaming("");
    chat.addStep({ label: "stale step" });
    chat.setStreaming(""); // reopen
    chat.commitStreaming("answer");
    expect(chat.messages.at(-1)).toEqual({
      role: "assistant",
      content: "answer",
      steps: undefined,
    });
  });

  it("commitStreaming with no live bubble does nothing", () => {
    const chat = renderChat();
    chat.commitStreaming();
    expect(chat.messages).toEqual([]);
  });

  it("stream() consumes an async iterable and returns the full text", async () => {
    const chat = renderChat();
    async function* deltas() {
      yield "a";
      yield "b";
      yield "c";
    }
    const text = await chat.stream(deltas());
    expect(text).toBe("abc");
    expect(chat.messages.at(-1)).toMatchObject({ role: "assistant", content: "abc" });
  });

  it("setUsage updates the cumulative session token snapshot", () => {
    const chat = renderChat();
    expect(() =>
      chat.setUsage({
        actualInput: 100,
        cachedInput: 20,
        output: 50,
        summarizer: 10,
        turns: 3,
      }),
    ).not.toThrow();
  });
});
