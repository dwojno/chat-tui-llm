import React from "react";
import { render, Box, Static } from "ink";
import type { UsageSnapshot } from "../integration/usage";
import type { LiveTurn, Message, Step } from "./types";
import { ChatMessage } from "./components/message";
import { StreamingMessage } from "./components/streaming-message";
import { Welcome } from "./components/welcome";
import { UsageBar, type ChatContextBar } from "./components/usage-bar";
import { PromptInput } from "./input/prompt-input";
import { PickerOverlay, PromptOverlay } from "./input/picker-overlay";
import type { PickerItem } from "./input/picker-keys";

export type { Message, Step, Role } from "./types";
export type { ChatContextBar } from "./components/usage-bar";

type OverlayState =
  | { kind: "picker"; title: string; subtitle?: string; items: PickerItem[]; createLabel: string }
  | { kind: "prompt"; title: string; placeholder: string };

interface ChatProps {
  messages: Message[];
  live?: LiveTurn | undefined;
  interactive: boolean;
  inputActive: boolean;
  overlay?: OverlayState | undefined;
  usage?: UsageSnapshot | undefined;
  context?: ChatContextBar | undefined;
  dimmed: boolean;
  onSubmit(line: string): void;
  onExit(): void;
  onOverlayResolve(value: string | "create" | null): void;
}

function Chat({
  messages,
  live,
  interactive,
  inputActive,
  overlay,
  usage,
  context,
  dimmed,
  onSubmit,
  onExit,
  onOverlayResolve,
}: ChatProps): React.JSX.Element {
  const empty = messages.length === 0 && live === undefined;
  return (
    <Box flexDirection="column" padding={1}>
      <Static items={messages}>
        {(message, index) => (
          <ChatMessage key={index} message={message} dimmed={dimmed && overlay !== undefined} />
        )}
      </Static>

      {empty && overlay === undefined && <Welcome />}

      {live !== undefined && <StreamingMessage steps={live.steps} content={live.content} />}

      {overlay?.kind === "picker" && (
        <PickerOverlay
          title={overlay.title}
          {...(overlay.subtitle !== undefined ? { subtitle: overlay.subtitle } : {})}
          items={overlay.items}
          createLabel={overlay.createLabel}
          onResolve={onOverlayResolve}
        />
      )}

      {overlay?.kind === "prompt" && (
        <PromptOverlay
          title={overlay.title}
          placeholder={overlay.placeholder}
          onResolve={onOverlayResolve}
        />
      )}

      {interactive && overlay === undefined && (
        <PromptInput active={inputActive} onSubmit={onSubmit} onExit={onExit} />
      )}

      {usage !== undefined && <UsageBar usage={usage} context={context} />}
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
  pickEntity(opts: {
    title: string;
    subtitle?: string | undefined;
    items: PickerItem[];
    createLabel: string;
  }): Promise<string | "create" | null>;
  promptInModal(opts: { title: string; placeholder: string }): Promise<string | null>;
  replaceMessages(next: readonly Message[]): void;
  onExit(handler: () => void): void;
  readonly messages: readonly Message[];
  setUsage(usage: UsageSnapshot): void;
  setContext(context: ChatContextBar): void;
  readonly conversationId: string;
  setConversationId(id: string): void;
  unmount(): void;
  waitUntilExit(): Promise<void>;
}

export function renderChat(
  initial: readonly Message[] = [],
  {
    interactive = false,
    initialUsage,
    initialContext,
    conversationId = "",
  }: {
    interactive?: boolean;
    initialUsage?: UsageSnapshot;
    initialContext?: ChatContextBar;
    conversationId?: string;
  } = {},
): ChatHandle {
  let messages: Message[] = [...initial];
  let live: LiveTurn | undefined;
  let inputActive = false;
  let overlay: OverlayState | undefined;
  let usage: UsageSnapshot | undefined = initialUsage;
  let context: ChatContextBar | undefined = initialContext;
  let activeConversationId = conversationId;
  let submit: ((line: string) => void) | null = null;
  let overlayResolve: ((value: string | "create" | null) => void) | null = null;
  let exitHandler: (() => void) | null = null;

  const handleSubmit = (line: string): void => {
    inputActive = false;
    const resolve = submit;
    submit = null;
    update();
    resolve?.(line);
  };

  const handleOverlayResolve = (value: string | "create" | null): void => {
    overlay = undefined;
    const resolve = overlayResolve;
    overlayResolve = null;
    update();
    resolve?.(value);
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
      overlay={overlay}
      usage={usage}
      context={context}
      dimmed={overlay !== undefined}
      onSubmit={handleSubmit}
      onExit={handleExit}
      onOverlayResolve={handleOverlayResolve}
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
    pickEntity(opts): Promise<string | "create" | null> {
      return new Promise((resolve) => {
        overlayResolve = resolve;
        overlay = {
          kind: "picker",
          title: opts.title,
          items: [...opts.items],
          createLabel: opts.createLabel,
          ...(opts.subtitle !== undefined ? { subtitle: opts.subtitle } : {}),
        };
        update();
      });
    },
    promptInModal(opts): Promise<string | null> {
      return new Promise((resolve) => {
        overlayResolve = (value) => {
          if (value === "create") {
            resolve(null);
            return;
          }
          resolve(value);
        };
        overlay = {
          kind: "prompt",
          title: opts.title,
          placeholder: opts.placeholder,
        };
        update();
      });
    },
    replaceMessages(next: readonly Message[]): void {
      messages = [...next];
      live = undefined;
      update();
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
    setContext(next: ChatContextBar): void {
      context = next;
      update();
    },
    get conversationId(): string {
      return activeConversationId;
    },
    setConversationId(id: string): void {
      activeConversationId = id;
      update();
    },
    unmount: () => {
      instance.unmount();
    },
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  };
}
