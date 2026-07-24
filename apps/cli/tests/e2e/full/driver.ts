import { rmSync, writeSync } from "node:fs";
import * as pty from "@lydell/node-pty";
import { stripAnsi } from "@tests/helpers/strip-ansi";

const ESC = String.fromCharCode(27);
export const KEY = { up: `${ESC}[A`, down: `${ESC}[B`, enter: "\r", esc: ESC } as const;

export interface SpawnTuiOptions {
  stateDir: string;
  turnsFile?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface Tui {
  send(text: string): void;
  type(text: string): Promise<void>;
  submit(text?: string): Promise<void>;
  ask(question: string, expected: string | RegExp, opts?: { timeout?: number }): Promise<string>;
  askSettled(question: string, opts?: { idleMs?: number }): Promise<string>;
  press(seq: string): void;
  snapshot(): string;
  clear(): void;
  waitFor(matcher: string | RegExp, opts?: { timeout?: number }): Promise<string>;
  waitIdle(ms?: number): Promise<void>;
  approve(): Promise<void>;
  deny(): Promise<void>;
  close(): Promise<void>;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function spawnTui(opts: SpawnTuiOptions): Tui {
  let buffer = "";
  const child = pty.spawn("pnpm", ["exec", "tsx", "apps/cli/tests/e2e/full/launch.ts"], {
    name: "xterm-color",
    cols: opts.cols ?? 100,
    rows: opts.rows ?? 40,
    cwd: process.cwd(),
    env: {
      ...process.env,
      CHAT_CLI_STATE_DIR: opts.stateDir,
      RAG_RERANK_ENABLED: "false",
      OTEL_ENABLED: "false",
      ...(opts.turnsFile !== undefined ? { E2E_TURNS_FILE: opts.turnsFile } : {}),
      ...opts.env,
    },
  });

  let exited = false;
  const done = new Promise<void>((resolve) => {
    child.onExit(() => {
      exited = true;
      resolve();
    });
  });
  child.onData((data) => {
    buffer += data;
    writeSync(1, data);
  });

  const snapshot = (): string => stripAnsi(buffer);

  async function waitFor(matcher: string | RegExp, { timeout = 30_000 } = {}): Promise<string> {
    const matches = (s: string): boolean =>
      typeof matcher === "string" ? s.includes(matcher) : matcher.test(s);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (matches(snapshot())) return snapshot();
      if (exited) break;
      await delay(50);
    }
    throw new Error(
      `waitFor timed out after ${timeout}ms waiting for ${matcher}\n--- frame tail ---\n${snapshot().slice(-2000)}`,
    );
  }

  async function waitIdle(ms = 400): Promise<void> {
    let seen = buffer.length;
    for (;;) {
      await delay(ms);
      if (buffer.length === seen) return;
      seen = buffer.length;
    }
  }

  async function approve(): Promise<void> {
    await waitFor("Approve action");
    child.write("a");
  }

  async function deny(): Promise<void> {
    await waitFor("Approve action");
    child.write("r");
  }

  async function close(): Promise<void> {
    if (!exited) {
      child.write("exit\r");
      await Promise.race([done, delay(4_000)]);
    }
    if (!exited) child.kill();
    rmSync(opts.stateDir, { recursive: true, force: true });
  }

  async function type(text: string): Promise<void> {
    for (const ch of text) {
      child.write(ch);
      await delay(15);
    }
  }

  async function submit(text = ""): Promise<void> {
    if (text) child.write(text);
    await delay(50);
    child.write("\r");
  }

  async function ask(
    question: string,
    expected: string | RegExp,
    waitOpts?: { timeout?: number },
  ): Promise<string> {
    buffer = "";
    await submit(question);
    const frame = await waitFor(expected, waitOpts);
    await waitIdle(700);
    return frame;
  }

  // Wait for the turn to *finish* rather than for specific answer text: while a turn
  // runs the TUI spinner animates (continuous output), so a sustained idle means the
  // answer has fully streamed and committed. Use this when the expected wording varies
  // (e.g. a model refusal) — then assert on the returned frame.
  async function askSettled(question: string, settleOpts?: { idleMs?: number }): Promise<string> {
    buffer = "";
    await submit(question);
    await waitFor(question.slice(0, 16));
    await waitIdle(settleOpts?.idleMs ?? 2000);
    return snapshot();
  }

  return {
    send: (text) => child.write(text),
    type,
    submit,
    ask,
    askSettled,
    press: (seq) => child.write(seq),
    snapshot,
    clear: () => {
      buffer = "";
    },
    waitFor,
    waitIdle,
    approve,
    deny,
    close,
  };
}
