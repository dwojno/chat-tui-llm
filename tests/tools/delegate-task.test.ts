import { describe, expect, it } from 'vitest'
import {
  DELEGATE_TASK_NAME,
  parseDelegateTaskArgs,
  toDelegateTaskOpenAITool,
} from '../../src/tools/delegate-task'

describe('parseDelegateTaskArgs', () => {
  it('parses a valid title + task payload', () => {
    const args = parseDelegateTaskArgs(JSON.stringify({ title: 'Compare X', task: 'compare a and b' }))
    expect(args).toEqual({ title: 'Compare X', task: 'compare a and b' })
  })

  it('rejects a payload missing the title', () => {
    expect(() => parseDelegateTaskArgs(JSON.stringify({ task: 'do it' }))).toThrow()
  })

  it('rejects an empty task', () => {
    expect(() => parseDelegateTaskArgs(JSON.stringify({ title: 'T', task: '' }))).toThrow()
  })
})

describe('toDelegateTaskOpenAITool', () => {
  it('produces a strict function-tool schema for the API', () => {
    const tool = toDelegateTaskOpenAITool()
    expect(tool).toMatchObject({
      type: 'function',
      name: DELEGATE_TASK_NAME,
      label: 'Delegating to a sub-agent',
      strict: true,
    })
    expect(tool.parameters).toBeDefined()
  })
})
