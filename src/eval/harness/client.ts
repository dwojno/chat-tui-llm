import { OpenAI } from 'openai'

let client: OpenAI | undefined

/**
 * One lazily-created OpenAI client shared by every task and scorer. Lazy so
 * importing an eval module never triggers the constructor (which throws without
 * a key) until a case actually runs.
 */
export function openai(): OpenAI {
  return (client ??= new OpenAI())
}
