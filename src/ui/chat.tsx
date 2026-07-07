import React from 'react'
import { render, Box, Text, Static, type TextProps } from 'ink'
import Markdown from './markdown'

export type Role = 'user' | 'assistant'

export interface Message {
  role: Role
  content: string
}

interface RoleMeta {
  label: string
  color: TextProps['color']
}

const ROLE_META: Record<Role, RoleMeta> = {
  user: { label: 'You', color: 'cyan' },
  assistant: { label: 'AI', color: 'green' },
}

interface ChatMessageProps {
  message: Message
}

function ChatMessage({ message }: ChatMessageProps): React.JSX.Element {
  const { label, color } = ROLE_META[message.role]
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      {message.role === 'assistant' ? (
        <Markdown>{message.content}</Markdown>
      ) : (
        <Text>{message.content}</Text>
      )}
    </Box>
  )
}

interface ChatProps {
  messages: Message[]
  streaming?: string
}

/** The chat view: finished messages stay static, the streaming one updates live. */
function Chat({ messages, streaming }: ChatProps): React.JSX.Element {
  return (
    <Box flexDirection="column" padding={1}>
      <Static items={messages}>
        {(message, index) => <ChatMessage key={index} message={message} />}
      </Static>

      {streaming !== undefined && (
        <ChatMessage
          message={{ role: 'assistant', content: streaming || '…' }}
        />
      )}
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
