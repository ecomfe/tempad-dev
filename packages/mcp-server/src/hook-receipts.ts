import { createHash } from 'node:crypto'
import { z } from 'zod'

export const HOOK_RECEIPT_LIMIT = 4096

export const HookReceiptSchema = z.object({
  invocationId: z.uuid(),
  signature: z.string(),
  result: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
  recordedAt: z.number()
})
export type HookReceipt = z.infer<typeof HookReceiptSchema>
export function hookSignature(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
