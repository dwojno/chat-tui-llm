import React, { useEffect, useState } from 'react'
import { render, Box, Text, Static, type TextProps } from 'ink'
import Markdown from './markdown'

export type Role = 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

interface RoleMeta {
  label: string
  icon: string
  color: TextProps['color']
}

const ROLE_META: Record<Role, RoleMeta> = {
  user: { label: 'You', icon: '🧑', color: 'cyan' },
  assistant: { label: 'AI', icon: '🤖', color: 'green' },
}

/**
 * A frame-cycling animation primitive. Owns its own timer via `useEffect`, so it
 * keeps ticking across the imperative `rerender`s that drive the chat — Ink
 * preserves component state as long as the element stays mounted.
 */
function useAnimationFrame(length: number, intervalMs: number): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(
      () => setFrame((f) => (f + 1) % length),
      intervalMs,
    )
    return () => clearInterval(id)
  }, [length, intervalMs])
  return frame
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** A braille spinner with a trailing label, e.g. `⠹ thinking…`. */
function Spinner({
  label,
  color,
}: {
  label: string
  color: TextProps['color']
}): React.JSX.Element {
  const frame = useAnimationFrame(SPINNER_FRAMES.length, 80)
  return (
    <Text color={color}>
      {SPINNER_FRAMES[frame]} <Text dimColor>{label}</Text>
    </Text>
  )
}

/** A blinking block cursor, to signal the assistant is still typing. */
function Cursor({ color }: { color: TextProps['color'] }): React.JSX.Element {
  const frame = useAnimationFrame(2, 450)
  return <Text color={color}>{frame === 0 ? '▋' : ' '}</Text>
}

/** The role header: a colored avatar dot, icon, and name. */
function MessageHeader({ role }: { role: Role }): React.JSX.Element {
  const { label, icon, color } = ROLE_META[role]
  return (
    <Text color={color} bold>
      ● {icon} {label}
    </Text>
  )
}

interface ChatMessageProps {
  message: Message
}

function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role={message.role} />
      <Box paddingLeft={2}>
        {message.role === 'assistant' ? (
          <Markdown>{message.content}</Markdown>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  )
}

/** The live assistant bubble: a spinner while waiting, then text + cursor. */
function StreamingMessage({ content }: { content: string }): React.JSX.Element {
  const { color } = ROLE_META.assistant
  return (
    <Box flexDirection="column" marginBottom={1}>
      <MessageHeader role="assistant" />
      <Box paddingLeft={2}>
        {content === '' ? (
          <Spinner label="thinking…" color={color} />
        ) : (
          <Box>
            <Markdown>{content}</Markdown>
            <Cursor color={color} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * Friendly empty state, shown until the first message lands.
 *
 * Deliberately static: it renders while the user is at the readline prompt, and
 * any animated rerender here would make Ink erase and redraw over the line the
 * user is typing. Animation is reserved for the streaming bubble, which only
 * shows once the prompt has been submitted.
 */
function Welcome(): React.JSX.Element {
  const sparkle = '✦'
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={2}
      marginBottom={1}
    >
      <Text color="magenta" bold>
        {sparkle} Welcome to Chat CLI {sparkle}
      </Text>
      <Text dimColor>Type a message and press Enter to start chatting.</Text>
      <Text dimColor>
        Commands: <Text color="yellow">/remember</Text>{' '}
        <Text color="yellow">/json</Text>{' '}
        <Text color="yellow">/structured</Text> · type{' '}
        <Text color="yellow">exit</Text> or Ctrl+C to quit.
      </Text>
    </Box>
  )
}

interface ChatProps {
  messages: Message[]
  streaming?: string
}

/** The chat view: finished messages stay static, the streaming one updates live. */
function Chat({ messages, streaming }: ChatProps): React.JSX.Element {
  const empty = messages.length === 0 && streaming === undefined
  return (
    <Box flexDirection="column" padding={1}>
      <Static items={messages}>
        {(message, index) => <ChatMessage key={index} message={message} />}
      </Static>

      {empty && <Welcome />}

      {streaming !== undefined && <StreamingMessage content={streaming} />}
    </Box>
  )
}

/** Handle returned by {@link renderChat} for driving the live chat UI. */
export interface ChatHandle {
  /** Append a completed message. */
  push(message: Message): void
  /** Replace the live assistant bubble's full content. */
  setStreaming(content: string): void
  /** Append a token delta to the live assistant bubble. */
  appendStreaming(delta: string): void
  /** Clear the live assistant bubble, committing `content` when provided. */
  commitStreaming(content?: string): void
  /**
   * Consume an async iterable of token deltas, rendering them live in the
   * assistant bubble, then commit the accumulated text as an assistant message.
   * Resolves with the full text.
   */
  stream(deltas: AsyncIterable<string>): Promise<string>
  /** Snapshot of the committed messages so far. */
  readonly messages: readonly Message[]
  /** Unmount the Ink app. */
  unmount(): void
  /** Resolves when the Ink app exits. */
  waitUntilExit(): Promise<void>
}

/**
 * Mount the chat UI and get back handles to drive it.
 *
 *   const chat = renderChat()
 *   chat.push({ role: 'user', content: 'hi' })
 *   chat.setStreaming('thinking...')   // live-updating assistant bubble
 *   chat.commitStreaming()             // freeze it into the message list
 *   chat.unmount()
 */
export function renderChat(initial: readonly Message[] = []): ChatHandle {
  let messages: Message[] = [...initial]
  let streaming: string | undefined

  // Don't let Ink put stdin in raw mode — readline needs line-buffered input
  // so `question()` resolves on Enter. Ctrl+C is handled by the caller's SIGINT.
  const instance = render(<Chat messages={messages} />, { exitOnCtrlC: false })

  const update = (): void =>
    instance.rerender(<Chat messages={messages} streaming={streaming} />)

  const commitAssistant = (content: string): void => {
    messages = [...messages, { role: 'assistant', content }]
    streaming = undefined
    update()
  }

  return {
    push(message: Message): void {
      messages = [...messages, message]
      update()
    },
    setStreaming(content: string): void {
      streaming = content
      update()
    },
    appendStreaming(delta: string): void {
      streaming = (streaming ?? '') + delta
      update()
    },
    commitStreaming(content?: string): void {
      const finalContent = content ?? streaming
      if (finalContent !== undefined) {
        commitAssistant(finalContent)
      }
    },
    async stream(deltas: AsyncIterable<string>): Promise<string> {
      let content = ''
      streaming = ''
      update()
      for await (const delta of deltas) {
        content += delta
        streaming = content
        update()
      }
      commitAssistant(content)
      return content
    },
    get messages(): readonly Message[] {
      return messages
    },
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  }
}
