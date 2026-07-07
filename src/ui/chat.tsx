import React, { useEffect, useState } from 'react'
import { render, Box, Text, Static, useInput, type TextProps } from 'ink'
import {
  slashCommandCatalog,
  type SlashCommandInfo,
} from '../commands/registry'
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
    const id = setInterval(() => setFrame((f) => (f + 1) % length), intervalMs)
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
        Press <Text color="yellow">/</Text> for commands · <Text color="yellow">exit</Text>{' '}
        or Ctrl+C to quit.
      </Text>
    </Box>
  )
}

const SLASH_COMMANDS: SlashCommandInfo[] = slashCommandCatalog()

/**
 * Which slash commands match the current line. Only offered while the user is
 * still typing the command token itself — a leading `/` with no space yet.
 */
function matchSuggestions(value: string): SlashCommandInfo[] {
  if (!/^\/\S*$/.test(value)) return []
  return SLASH_COMMANDS.filter((command) => command.completion.startsWith(value))
}

interface PromptInputProps {
  /** When false, the field is hidden but still listens for Ctrl+C / Ctrl+D. */
  active: boolean
  onSubmit(line: string): void
  onExit(): void
}

/**
 * The interactive prompt: a text field with a movable block cursor and a live
 * `/` autocomplete menu. Owns the whole input line (no readline), so Ink can
 * repaint freely without clobbering what the user has typed.
 */
function PromptInput({
  active,
  onSubmit,
  onExit,
}: PromptInputProps): React.JSX.Element | null {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState(0)

  const suggestions = active ? matchSuggestions(value) : []
  const menuOpen = suggestions.length > 0
  const sel = menuOpen ? Math.min(selected, suggestions.length - 1) : 0

  const accept = (command: SlashCommandInfo): void => {
    setValue(command.completion)
    setCursor(command.completion.length)
    setSelected(0)
  }

  useInput((input, key) => {
    // Interrupts work whether or not the field is currently accepting input.
    // Terminals disagree on how Ctrl+C/D surface (with or without `key.ctrl`),
    // so match the raw control bytes too.
    const ctrlC = (key.ctrl && input === 'c') || input === '\u0003'
    const ctrlD = (key.ctrl && input === 'd') || input === '\u0004'
    if (ctrlC) return onExit()
    if (ctrlD && value === '') return onExit()
    if (!active) return

    if (key.upArrow) {
      if (menuOpen) {
        setSelected((s) => (s - 1 + suggestions.length) % suggestions.length)
      }
      return
    }
    if (key.downArrow) {
      if (menuOpen) setSelected((s) => (s + 1) % suggestions.length)
      return
    }
    if (key.tab) {
      if (menuOpen) accept(suggestions[sel])
      return
    }
    if (key.return) {
      // With the menu open, Enter accepts the highlighted command; otherwise it
      // submits the line.
      if (menuOpen) {
        accept(suggestions[sel])
        return
      }
      const line = value
      setValue('')
      setCursor(0)
      setSelected(0)
      onSubmit(line)
      return
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1))
      return
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1))
      return
    }
    if (key.ctrl && input === 'a') {
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'e') {
      setCursor(value.length)
      return
    }
    // Backspace and Delete both erase the character before the cursor — the
    // common case in a single-line prompt, and robust across terminals that
    // disagree on which key code they send.
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor))
        setCursor((c) => c - 1)
        setSelected(0)
      }
      return
    }
    // Any other printable input (including pasted text) inserts at the cursor.
    // Control characters (stray escape sequences, unmapped chords) are dropped
    // so they never pollute the line.
    if (input && !key.ctrl && !key.meta && !/[\u0000-\u001f]/.test(input)) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor))
      setCursor((c) => c + input.length)
      setSelected(0)
    }
  })

  if (!active) return null

  const before = value.slice(0, cursor)
  const atCursor = value.slice(cursor, cursor + 1) || ' '
  const after = value.slice(cursor + 1)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          {'❯ '}
        </Text>
        <Text>{before}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{after}</Text>
      </Box>
      {menuOpen && (
        <Box flexDirection="column" paddingLeft={2}>
          {suggestions.map((command, i) => (
            <Text key={command.completion} color={i === sel ? 'cyan' : 'gray'}>
              {i === sel ? '❯ ' : '  '}
              <Text bold={i === sel}>{command.completion.trim()}</Text>
              <Text dimColor> — {command.hint}</Text>
            </Text>
          ))}
          <Text dimColor>{'  '}↑↓ to select · Tab/Enter to complete</Text>
        </Box>
      )}
    </Box>
  )
}

interface ChatProps {
  messages: Message[]
  streaming?: string
  interactive: boolean
  inputActive: boolean
  onSubmit(line: string): void
  onExit(): void
}

/** The chat view: finished messages stay static, the streaming one updates live. */
function Chat({
  messages,
  streaming,
  interactive,
  inputActive,
  onSubmit,
  onExit,
}: ChatProps): React.JSX.Element {
  const empty = messages.length === 0 && streaming === undefined
  return (
    <Box flexDirection="column" padding={1}>
      <Static items={messages}>
        {(message, index) => <ChatMessage key={index} message={message} />}
      </Static>

      {empty && <Welcome />}

      {streaming !== undefined && <StreamingMessage content={streaming} />}

      {interactive && (
        <PromptInput active={inputActive} onSubmit={onSubmit} onExit={onExit} />
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
  /**
   * Activate the interactive prompt and resolve with the next submitted line.
   * Only meaningful in interactive (TTY) mode; the REPL reads lines elsewhere
   * otherwise.
   */
  question(): Promise<string>
  /** Register the handler run on Ctrl+C / Ctrl+D from the interactive prompt. */
  onExit(handler: () => void): void
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
 *   const line = await chat.question()   // interactive prompt (TTY)
 *   chat.setStreaming('')                // live-updating assistant bubble
 *   chat.commitStreaming('done')         // freeze it into the message list
 *   chat.unmount()
 */
export function renderChat(
  initial: readonly Message[] = [],
  { interactive = false }: { interactive?: boolean } = {},
): ChatHandle {
  let messages: Message[] = [...initial]
  let streaming: string | undefined
  let inputActive = false
  let submit: ((line: string) => void) | null = null
  let exitHandler: (() => void) | null = null

  const handleSubmit = (line: string): void => {
    inputActive = false
    const resolve = submit
    submit = null
    update()
    resolve?.(line)
  }

  const handleExit = (): void => {
    exitHandler?.()
  }

  const view = (): React.JSX.Element => (
    <Chat
      messages={messages}
      streaming={streaming}
      interactive={interactive}
      inputActive={inputActive}
      onSubmit={handleSubmit}
      onExit={handleExit}
    />
  )

  // In interactive mode Ink owns stdin (raw mode) and drives editing via
  // `useInput`; Ctrl+C is routed through `onExit` rather than exiting Ink.
  const instance = render(view(), { exitOnCtrlC: false })

  const update = (): void => instance.rerender(view())

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
    question(): Promise<string> {
      return new Promise((resolve) => {
        submit = resolve
        inputActive = true
        update()
      })
    },
    onExit(handler: () => void): void {
      exitHandler = handler
    },
    get messages(): readonly Message[] {
      return messages
    },
    unmount: instance.unmount,
    waitUntilExit: () => instance.waitUntilExit().then(() => undefined),
  }
}
