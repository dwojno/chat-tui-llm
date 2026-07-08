import React from "react";
import { render, Box, Static } from "ink";
import type { UsageSnapshot } from "../integration/usage";
import type { LiveTurn, Message, Step } from "./types";
import { ChatMessage } from "./components/message";
import { StreamingMessage } from "./components/streaming-message";
import { Welcome } from "./components/welcome";
import { UsageBar } from "./components/usage-bar";
import { PromptInput } from "./input/prompt-input";

export type { Message, Step, Role } from "./types";

interface ChatProps {
  messages: Message[];
  live?: LiveTurn;
  interactive: boolean;
  inputActive: boolean;
  usage?: UsageSnapshot;
  onSubmit(line: string): void;
  onExit(): void;
}

function Chat({
  messages,
  live,
  interactive,
  inputActive,
  usage,
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

      {usage !== undefined && <UsageBar usage={usage} />}
    </Box>
  );
}

export interface ChatHandle {
  push(message: Message): void;
  setStreaming(content: string): void;
  addStep(step: Step): void;
  appendStreaming(delta: string): void;
  commitStreaming(content?: string): void;
  stream(deltas: AsyncIterable<string>): Promise<string>;
  question(): Promise<string>;
  onExit(handler: () => void): void;
  readonly messages: readonly Message[];
  setUsage(usage: UsageSnapshot): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
}

export function renderChat(
  initial: readonly Message[] = [],
  {
    interactive = false,
    initialUsage,
  }: { interactive?: boolean; initialUsage?: UsageSnapshot } = {},
): ChatHandle {
  let messages: Message[] = [...initial];
  let live: LiveTurn | undefined;
  let inputActive = false;
  let usage: UsageSnapshot | undefined = initialUsage;
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
      usage={usage}
      onSubmit={handleSubmit}
      onExit={handleExit}
    />
  );

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
    setUsage(next: UsageSnapshot): void {
      usage = next;
      update();
    },
    unmount: () => {
      instance.unmount();
    },
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
