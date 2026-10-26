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
export const LEGACY_HOOK_EXHAUSTED_RESULT = {
  ...EXPIRED_HOOK_RESULT,
  runtimeHookLegacyUpgradeRequired: true
} as const
export class LegacyHookCapacityError extends Error {
  constructor() {
    super(
      'Legacy lifecycle history is full. Update the TemPad Dev plugin to use receipt-capable hooks.'
    )
  }
}
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

export function hookRetentionCutoff(previous: number, now = Date.now()) {
  return Math.max(previous, now - CLIENT_HOOK_RETENTION_MS)
}

/** Make room for one completed result without expiring an unresolved effect. */
export function hookPressureCutoff(cutoff: number, completed: number[], unresolved: number[]) {
  const excess = completed.length + unresolved.length - HOOK_RECEIPT_LIMIT
  if (excess < 0 || !completed.length) return cutoff
  const oldest = completed.sort((a, b) => a - b)[Math.min(excess, completed.length - 1)]!
  return Math.max(cutoff, Math.min(oldest, ...unresolved.map((issuedAt) => issuedAt - 1)))
}

export function hookCutoff(input: ClientHook, previous: number, now = Date.now()) {
  const cutoff = hookRetentionCutoff(previous, now)
  if (input.version === 2) {
    if (input.issuedAt <= cutoff) throw new ExpiredHookError(cutoff)
    if (input.issuedAt > now + 60_000) throw new Error('Lifecycle invocation clock is invalid.')
  }
  return cutoff
}
