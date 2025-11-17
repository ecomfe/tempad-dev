import { z } from 'zod'

export const MessageFromExtensionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('activate') }),
  z.object({
    type: z.literal('toolResult'),
    req: z.string(),
    ok: z.boolean(),
    payload: z.unknown()
  })
])
