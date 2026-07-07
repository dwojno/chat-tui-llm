import type { ParsedResponse } from 'openai/resources/responses/responses.mjs'
import type { TurnOptions } from './options'
import type { StructuredResponse } from './schemas'

export function formatAssistantContent(
  answer: string | undefined,
  sources: string[] | undefined,
): string {
  const sourceList = sources?.length ? sources.join('\n') : ''
  return sourceList
    ? `${answer ?? ''}\n\nSources: ${sourceList}`
    : (answer ?? '')
}

export function formatResponse(
  response: ParsedResponse<unknown>,
  options: Pick<TurnOptions, 'structured_output' | 'json_mode'>,
): string {
  if (options.structured_output) {
    const parsed = response.output_parsed as StructuredResponse | null
    return formatAssistantContent(parsed?.answer, parsed?.sources)
  }

  return response.output_text
}
