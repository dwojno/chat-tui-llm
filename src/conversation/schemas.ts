import { z, ZodSchema } from 'zod'

export const ResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(z.string()),
})

export type ParsedResponse = z.infer<typeof ResponseSchema>

export type GetResponseOptions = {
  stream: boolean
  temperature: number
  max_output_tokens: number
  structured_output: ZodSchema | undefined
  json_mode: boolean
}

export const DEFAULT_GET_RESPONSE_OPTIONS = {
  stream: true,
  temperature: 0.7,
  max_output_tokens: 1000,
  structured_output: undefined,
  json_mode: false,
} satisfies GetResponseOptions
