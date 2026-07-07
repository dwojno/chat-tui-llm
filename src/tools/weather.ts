import { z } from 'zod'
import type { ToolDefinition } from './types'

const parameters = z.object({
  city: z.string(),
})

async function execute({ city }: z.infer<typeof parameters>): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  return `The weather in ${city} is sunny`
}

export const weatherTool: ToolDefinition<typeof parameters> = {
  name: 'get_weather_data',
  description: 'Get the weather data for a city',
  parameters,
  execute,
}
