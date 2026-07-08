import React, { useEffect, useMemo, useState } from "react";
import { render, Box, Text, Static, useInput, type TextProps } from "ink";
import { slashCommandCatalog, type SlashCommandInfo } from "../commands/registry";
import {
  matchFileMentionToken,
  suggestFilesAtCursor,
  type FileSuggestion,
} from "./file-suggestions";
import Markdown from "./markdown";

export type Role = "user" | "assistant";

/** One entry in the "thinking" trace: a tool call or a status update. */
export interface Step {
  /** Human-readable, already-localized description (e.g. "Fetching weather data"). */
  label: string;
  /** Per-call detail drawn from the tool's arguments (e.g. the query or city). */
  detail?: string;
  /** When set, this step is a delegated sub-agent's activity under the named task. */
  fork?: string;
}

export interface Message {
  role: Role;
  content: string;
  /**
   * The activity trace for an assistant turn that called tools — one entry per
   * step. Kept on the committed message so the "thinking" steps stay visible
   * above the answer instead of vanishing once it streams in.
   */
  steps?: Step[];
}

interface RoleMeta {
  label: string;
  icon: string;
  color: TextProps["color"];
}

const ROLE_META: Record<Role, RoleMeta> = {
  user: { label: "You", icon: "🧑", color: "cyan" },
  assistant: { label: "AI", icon: "🤖", color: "green" },
};

/**
 * A frame-cycling animation primitive. Owns its own timer via `useEffect`, so it
 * keeps ticking across the imperative `rerender`s that drive the chat — Ink
 * preserves component state as long as the element stays mounted.
 */
function useAnimationFrame(length: number, intervalMs: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % length), intervalMs);
    return () => clearInterval(id);
  }, [length, intervalMs]);
  return frame;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** A braille spinner with a trailing label, e.g. `⠹ thinking…`. */
function Spinner({
  label,
  color,
}: {
  label: string;
  color: TextProps["color"];
}): React.JSX.Element {
  const frame = useAnimationFrame(SPINNER_FRAMES.length, 80);
  return (
    <Text color={color}>
      {SPINNER_FRAMES[frame]} <Text dimColor>{label}</Text>
    </Text>
  );
}

/** A blinking block cursor, to signal the assistant is still typing. */
function Cursor({ color }: { color: TextProps["color"] }): React.JSX.Element {
  const frame = useAnimationFrame(2, 450);
  return <Text color={color}>{frame === 0 ? "▋" : " "}</Text>;
}

/** The role header: a colored avatar dot, icon, and name. */
function MessageHeader({ role }: { role: Role }): React.JSX.Element {
  const { label, icon, color } = ROLE_META[role];
  return (
    <Text color={color} bold>
      ● {icon} {label}
    </Text>
  );
}

/** Trim a string to a short tag for the trace, e.g. "compare SSR vs SS…". */
function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * The text after a step's marker: `label — detail · forkTag`. `detail` is the
 * specific call (query/city); the fork tag names the sub-agent so parallel
 * forks stay distinguishable.
 */
function stepText(step: Step): string {
  const detail = step.detail ? ` — ${truncate(step.detail, 48)}` : "";
  const tag = step.fork ? ` · ${truncate(step.fork, 32)}` : "";
  return `${step.label}${detail}${tag}`;
}

/** One trace row: a spinner while running, a dim `✓` once done. Sub-agent steps
 * (`step.fork`) are indented so nested activity reads as nested. */
function StepRow({ step, active }: { step: Step; active: boolean }): React.JSX.Element {
  return (
    <Box paddingLeft={step.fork ? 2 : 0}>
      {active ? (
        <Spinner label={stepText(step)} color="green" />
      ) : (
        <Text dimColor>✓ {stepText(step)}</Text>
      )}
    </Box>
  );
}

/**
 * The "thinking" trace: one line per step the turn took. When `active` the
 * steps are still running, so each spins — a round of tool calls launched
 * together thus spins together, reflecting that they ran in parallel. Once the
 * answer streams in (or the turn commits) they freeze to a dim `✓` and stay
 * rendered above the answer (à la Gemini's thinking summary).
 */
function StepList({ steps, active }: { steps: Step[]; active: boolean }): React.JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <Box flexDirection="column">
      {steps.map((step, index) => (
        <StepRow key={index} step={step} active={active} />
      ))}
    </Box>
  );
}

interface ChatMessageProps {
  message: Message;
}

function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  const steps = message.role === "assistant" ? message.steps : undefined;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role={message.role} />
      <Box flexDirection="column" paddingLeft={2}>
        {steps && <StepList steps={steps} active={false} />}
        {message.role === "assistant" ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
}

/**
 * The live assistant bubble: the running step trace, then the streamed answer
 * with a cursor. Before any step or token lands it's a lone `thinking…` spinner.
 */
function StreamingMessage({
  steps,
  content,
}: {
  steps: Step[];
  content: string;
}): React.JSX.Element {
  const { color } = ROLE_META.assistant;
  const answering = content !== "";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role="assistant" />
      <Box flexDirection="column" paddingLeft={2}>
        <StepList steps={steps} active={!answering} />
        {answering ? (
          <Box>
            <Markdown>{content}</Markdown>
            <Cursor color={color} />
          </Box>
        ) : steps.length === 0 ? (
          <Spinner label="thinking…" color={color} />
        ) : null}
      </Box>
    </Box>
  );
}

/**
 * Friendly empty state, shown until the first message lands. Deliberately
 * static so it doesn't rerender while the user is composing their first line.
 */
function Welcome(): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      marginBottom={1}
    >
      <Text color="magenta" bold>
        ✦ Welcome to Chat CLI ✦
      </Text>
      <Text dimColor>Type a message and press Enter to start chatting.</Text>
      <Text dimColor>
        Press <Text color="yellow">@</Text> to attach a file · <Text color="yellow">/</Text> for
        commands · <Text color="yellow">exit</Text> or Ctrl+C to quit.
      </Text>
    </Box>
  );
}

const SLASH_COMMANDS: SlashCommandInfo[] = slashCommandCatalog();

/**
 * Which slash commands match the current line. Only offered while the user is
 * still typing the command token itself — a leading `/` with no space yet.
 */
function matchSuggestions(value: string): SlashCommandInfo[] {
  if (!/^\/\S*$/.test(value)) return [];
  return SLASH_COMMANDS.filter((command) => command.completion.startsWith(value));
}

type ActiveSuggestions =
  | { kind: "slash"; items: SlashCommandInfo[] }
  | { kind: "file"; items: FileSuggestion[] };

function activeSuggestions(value: string, cursor: number): ActiveSuggestions | null {
  const slash = matchSuggestions(value);
  if (slash.length) return { kind: "slash", items: slash };
  const files = suggestFilesAtCursor(value, cursor);
  if (files.length) return { kind: "file", items: files };
  return null;
}

interface SuggestionMenuProps {
  suggestions: ActiveSuggestions;
  selected: number;
}

function SuggestionMenu({ suggestions, selected }: SuggestionMenuProps): React.JSX.Element {
  const sel = Math.min(selected, suggestions.items.length - 1);

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {suggestions.kind === "slash"
        ? suggestions.items.map((command, i) => (
            <Text key={command.completion} color={i === sel ? "cyan" : "gray"}>
              {i === sel ? "❯ " : "  "}
              <Text bold={i === sel}>{command.completion.trim()}</Text>
              <Text dimColor> — {command.hint}</Text>
            </Text>
          ))
        : suggestions.items.map((file, i) => (
            <Text key={file.path} color={i === sel ? "cyan" : "gray"}>
              {i === sel ? "❯ " : "  "}
              <Text bold={i === sel}>{file.label}</Text>
            </Text>
          ))}
      <Text dimColor>{"  "}↑↓ to select · Tab/Enter to complete</Text>
    </Box>
  );
}

interface PromptInputProps {
  /** When false, the field is hidden but still listens for Ctrl+C / Ctrl+D. */
  active: boolean;
  onSubmit(line: string): void;
  onExit(): void;
}

/**
 * The interactive prompt: a text field with a movable block cursor and a live
 * `/` autocomplete menu. Owns the whole input line (no readline), so Ink can
 * repaint freely without clobbering what the user has typed.
 */
function PromptInput({ active, onSubmit, onExit }: PromptInputProps): React.JSX.Element | null {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);

  const suggestions = useMemo(
    () => (active ? activeSuggestions(value, cursor) : null),
    [active, value, cursor],
  );
  const menuOpen = suggestions !== null;
  const sel = menuOpen ? Math.min(selected, suggestions.items.length - 1) : 0;

  const acceptSlash = (command: SlashCommandInfo): void => {
    setValue(command.completion);
    setCursor(command.completion.length);
    setSelected(0);
  };

  const acceptFile = (file: FileSuggestion): void => {
    const token = matchFileMentionToken(value, cursor);
    if (!token) return;
    const insertion = `@${file.path} `;
    const next = value.slice(0, token.start) + insertion + value.slice(cursor);
    setValue(next);
    setCursor(token.start + insertion.length);
    setSelected(0);
  };

  const acceptHighlighted = (): void => {
    if (!suggestions) return;
    if (suggestions.kind === "slash") acceptSlash(suggestions.items[sel]);
    else acceptFile(suggestions.items[sel]);
  };

  useInput((input, key) => {
    // Interrupts work whether or not the field is currently accepting input.
    // Terminals disagree on how Ctrl+C/D surface (with or without `key.ctrl`),
    // so match the raw control bytes too.
    const ctrlC = (key.ctrl && input === "c") || input === "\u0003";
    const ctrlD = (key.ctrl && input === "d") || input === "\u0004";
    if (ctrlC) return onExit();
    if (ctrlD && value === "") return onExit();
    if (!active) return;

    if (key.upArrow) {
      if (menuOpen && suggestions) {
        setSelected((s) => (s - 1 + suggestions.items.length) % suggestions.items.length);
      }
      return;
    }
    if (key.downArrow) {
      if (menuOpen && suggestions) {
        setSelected((s) => (s + 1) % suggestions.items.length);
      }
      return;
    }
    if (key.tab) {
      if (menuOpen) acceptHighlighted();
      return;
    }
    if (key.return) {
      // With the menu open, Enter accepts the highlighted command; otherwise it
      // submits the line.
      if (menuOpen) {
        acceptHighlighted();
        return;
      }
      const line = value;
      setValue("");
      setCursor(0);
      setSelected(0);
      onSubmit(line);
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (key.ctrl && input === "a") {
      setCursor(0);
      return;
    }
    if (key.ctrl && input === "e") {
      setCursor(value.length);
      return;
    }
    // Backspace and Delete both erase the character before the cursor — the
    // common case in a single-line prompt, and robust across terminals that
    // disagree on which key code they send.
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor((c) => c - 1);
        setSelected(0);
      }
      return;
    }
    // Any other printable input (including pasted text) inserts at the cursor.
    // Control characters (stray escape sequences, unmapped chords) are dropped
    // so they never pollute the line.
    // oxlint-disable-next-line no-control-regex -- intentional: filter terminal control chars
    if (input && !key.ctrl && !key.meta && !/[\u0000-\u001f]/.test(input)) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor((c) => c + input.length);
      setSelected(0);
    }
  });

  if (!active) return null;

  const before = value.slice(0, cursor);
  const atCursor = value.slice(cursor, cursor + 1) || " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          {"❯ "}
        </Text>
        <Text>{before}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{after}</Text>
      </Box>
      {menuOpen && suggestions && <SuggestionMenu suggestions={suggestions} selected={sel} />}
    </Box>
  );
}

/** A turn in flight: its accumulated step trace and streamed answer text. */
interface LiveTurn {
  steps: Step[];
  content: string;
}

interface ChatProps {
  messages: Message[];
  live?: LiveTurn;
  interactive: boolean;
  inputActive: boolean;
  onSubmit(line: string): void;
  onExit(): void;
}

/** The chat view: finished messages stay static, the live turn updates. */
function Chat({
  messages,
  live,
  interactive,
  inputActive,
  onSubmit,
  onExit,
}: ChatProps): React.JSX.Element {
  const empty = messages.length === 0 && live === undefined;
  return (
    <Box flexDirection="column" padding={1}>
      <Static items={messages}>
        {(message, index) => <ChatMessage key={index} message={message} />}
      </Static>

      {empty && <Welcome />}

      {live !== undefined && <StreamingMessage steps={live.steps} content={live.content} />}

      {interactive && <PromptInput active={inputActive} onSubmit={onSubmit} onExit={onExit} />}
    </Box>
  );
}

/** Handle returned by {@link renderChat} for driving the live chat UI. */
export interface ChatHandle {
  /** Append a completed message. */
  push(message: Message): void;
  /** Open a fresh live assistant bubble (clears any prior step trace). */
  setStreaming(content: string): void;
  /** Append one step to the live bubble's thinking trace (e.g. a tool call). */
  addStep(step: Step): void;
  /** Append a token delta to the live assistant bubble. */
  appendStreaming(delta: string): void;
  /**
   * Clear the live assistant bubble, committing `content` when provided. Any
   * accumulated step trace is preserved on the committed message.
   */
  commitStreaming(content?: string): void;
  /**
   * Consume an async iterable of token deltas, rendering them live in the
   * assistant bubble, then commit the accumulated text as an assistant message.
   * Resolves with the full text.
   */
  stream(deltas: AsyncIterable<string>): Promise<string>;
  /**
   * Activate the interactive prompt and resolve with the next submitted line.
   * Only meaningful in interactive (TTY) mode; the REPL reads lines elsewhere
   * otherwise.
   */
  question(): Promise<string>;
  /** Register the handler run on Ctrl+C / Ctrl+D from the interactive prompt. */
  onExit(handler: () => void): void;
  /** Snapshot of the committed messages so far. */
  readonly messages: readonly Message[];
  /** Unmount the Ink app. */
  unmount(): void;
  /** Resolves when the Ink app exits. */
  waitUntilExit(): Promise<void>;
}

/**
 * Mount the chat UI and get back handles to drive it.
 *
 *   const chat = renderChat()
 *   chat.push({ role: 'user', content: 'hi' })
 *   const line = await chat.question()   // interactive prompt (TTY)
 *   chat.setStreaming('')                // live-updating assistant bubble
 *   chat.commitStreaming('done')         // freeze it into the message list
 *   chat.unmount()
 */
export function renderChat(
  initial: readonly Message[] = [],
  { interactive = false }: { interactive?: boolean } = {},
): ChatHandle {
  let messages: Message[] = [...initial];
  let live: LiveTurn | undefined;
  let inputActive = false;
  let submit: ((line: string) => void) | null = null;
  let exitHandler: (() => void) | null = null;

  const handleSubmit = (line: string): void => {
    inputActive = false;
    const resolve = submit;
    submit = null;
    update();
    resolve?.(line);
  };

  const handleExit = (): void => {
    exitHandler?.();
  };

  const view = (): React.JSX.Element => (
    <Chat
      messages={messages}
      live={live}
      interactive={interactive}
      inputActive={inputActive}
      onSubmit={handleSubmit}
      onExit={handleExit}
    />
  );

  // Run in the terminal's alternate screen buffer (like vim / less): take over
  // the whole screen on launch, and restore the user's previous terminal
  // contents on quit. Only when we actually own an interactive TTY — piped or
  // test runs leave the primary screen untouched.
  const useAltScreen = interactive && process.stdout.isTTY === true;
  let altScreenActive = false;
  const enterAltScreen = (): void => {
    if (useAltScreen && !altScreenActive) {
      // `?1049h`: save cursor, switch to (cleared) alt buffer; then home.
      process.stdout.write("\x1b[?1049h\x1b[H");
      altScreenActive = true;
    }
  };
  const leaveAltScreen = (): void => {
    if (altScreenActive) {
      process.stdout.write("\x1b[?1049l"); // restore the primary screen + cursor
      altScreenActive = false;
    }
  };

  enterAltScreen();
  // Safety net: restore the primary screen even if we exit without a clean
  // unmount (crash / uncaught signal), so the terminal is never left stuck.
  if (useAltScreen) process.on("exit", leaveAltScreen);

  // In interactive mode Ink owns stdin (raw mode) and drives editing via
  // `useInput`; Ctrl+C is routed through `onExit` rather than exiting Ink.
  const instance = render(view(), { exitOnCtrlC: false });

  const update = (): void => instance.rerender(view());

  const commitAssistant = (content: string, steps?: Step[]): void => {
    messages = [
      ...messages,
      { role: "assistant", content, steps: steps?.length ? steps : undefined },
    ];
    live = undefined;
    update();
  };

  return {
    push(message: Message): void {
      messages = [...messages, message];
      update();
    },
    setStreaming(content: string): void {
      live = { steps: [], content };
      update();
    },
    addStep(step: Step): void {
      const base = live ?? { steps: [], content: "" };
      live = { ...base, steps: [...base.steps, step] };
      update();
    },
    appendStreaming(delta: string): void {
      const base = live ?? { steps: [], content: "" };
      live = { ...base, content: base.content + delta };
      update();
    },
    commitStreaming(content?: string): void {
      const finalContent = content ?? live?.content;
      if (finalContent !== undefined) {
        commitAssistant(finalContent, live?.steps);
      }
    },
    async stream(deltas: AsyncIterable<string>): Promise<string> {
      let content = "";
      live = { steps: [], content: "" };
      update();
      for await (const delta of deltas) {
        content += delta;
        live = { steps: live?.steps ?? [], content };
        update();
      }
      commitAssistant(content, live?.steps);
      return content;
    },
    question(): Promise<string> {
      return new Promise((resolve) => {
        submit = resolve;
        inputActive = true;
        update();
      });
    },
    onExit(handler: () => void): void {
      exitHandler = handler;
    },
    get messages(): readonly Message[] {
      return messages;
    },
    unmount: () => {
      // Tear down Ink first (its final cleanup writes to the alt buffer), then
      // restore the primary screen so anything printed afterwards (e.g. the
      // token report) lands on the user's original terminal.
      instance.unmount();
      leaveAltScreen();
    },
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
