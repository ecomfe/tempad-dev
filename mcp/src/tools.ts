import { z } from 'zod'

export const TOOLS = [
  {
    name: 'get_price',
    description: 'Returns the latest price of a stock.',
    parameters: z.object({
      symbol: z.string().length(4, 'Stock symbol must be 4 characters.')
    })
  },
  {
    name: 'weather',
    description: 'Returns the current weather for a city.',
    parameters: z.object({
      city: z.string().min(1, 'City name cannot be empty.')
    })
  }
] as const
