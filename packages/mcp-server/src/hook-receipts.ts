import { CLIENT_HOOK_RETENTION_MS, type ClientHook } from '@tempad-dev/shared'
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const HOOK_RECEIPT_LIMIT = 4096

export const HookReceiptSchema = z.object({
  invocationId: z.uuid(),
  signature: z.string(),
  result: z.record(z.string(), z.unknown()),
  retired: z.literal('expired').optional(),
  error: z.string().optional(),
  recordedAt: z.number(),
  issuedAt: z.number().optional()
})
export type HookReceipt = z.infer<typeof HookReceiptSchema>

export const EXPIRED_HOOK_RESULT = { runtimeHookDisposition: 'expired' } as const
export function isExpiredHookResult(result: Record<string, unknown>): boolean {
  return result.runtimeHookDisposition === 'expired'
}

export class ExpiredHookError extends Error {
  constructor(readonly cutoff: number) {
    super('Lifecycle invocation is expired and cannot be replayed. Send a fresh lifecycle event.')
  }
}
export function hookSignature(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function hookCutoff(input: ClientHook, previous: number, now = Date.now()) {
  const cutoff = Math.max(previous, now - CLIENT_HOOK_RETENTION_MS)
  if (input.version === 2) {
    if (input.issuedAt <= cutoff) throw new ExpiredHookError(cutoff)
    if (input.issuedAt > now + 60_000) throw new Error('Lifecycle invocation clock is invalid.')
  }
  return cutoff
}
