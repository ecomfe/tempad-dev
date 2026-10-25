import { z } from 'zod'

import { RuntimeProfileSchema } from './protocol'

const LifecycleSchema = z.object({
  kind: z.enum(['codex', 'claude']),
  sessionId: z.string().min(1).max(256),
  event: z.enum([
    'PreToolUse',
    'PostToolUse',
    'UserPromptSubmit',
    'Stop',
    'Interrupt',
    'SessionEnd'
  ]),
  invocationId: z.uuid(),
  turnId: z.string().min(1).max(256).optional(),
  taskId: z.string().min(1).max(128).optional()
})

export const ClientHookParamsSchema = z.discriminatedUnion('version', [
  LifecycleSchema.extend({ version: z.literal(1) }).strict(),
  LifecycleSchema.extend({
    version: z.literal(2),
    profile: RuntimeProfileSchema,
    issuedAt: z.number().int().positive()
  }).strict()
])
export const ClientHookRequestSchema = z.object({
  method: z.literal('tempad/client-hook'),
  params: ClientHookParamsSchema
})
export type ClientHook = z.infer<typeof ClientHookParamsSchema>

/** A durable admission receipt does not claim that the lifecycle effect ran. */
export const ClientHookReceiptSchema = z
  .object({
    version: z.literal(2),
    invocationId: z.uuid(),
    state: z.enum(['accepted', 'applied'])
  })
  .strict()
export const CLIENT_HOOK_RETENTION_MS = 24 * 60 * 60 * 1000
