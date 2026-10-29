import { describe, expect, it } from 'vitest'

import { ClientHookParamsSchema, ClientHookReceiptSchema } from '../src/mcp/client-hook'

const legacy = {
  version: 1,
  kind: 'claude',
  sessionId: 'session',
  event: 'Stop',
  invocationId: '6b6caf70-9f7e-4cea-8abd-443750e03310'
}
describe('installed lifecycle hook contract', () => {
  it('retains the strict legacy shape', () => {
    expect(ClientHookParamsSchema.parse(legacy)).toEqual(legacy)
    expect(
      ClientHookParamsSchema.safeParse({ ...legacy, profile: { kind: 'release' } }).success
    ).toBe(false)
  })
  it('requires explicit profile and time for bounded receipt-capable retries', () => {
    const current = {
      ...legacy,
      version: 2,
      profile: { kind: 'checkout', id: 'a'.repeat(16) },
      issuedAt: 1
    }
    expect(ClientHookParamsSchema.parse(current)).toEqual(current)
    expect(ClientHookParamsSchema.safeParse({ ...legacy, version: 2 }).success).toBe(false)
    expect(
      ClientHookParamsSchema.safeParse({ ...current, profile: { kind: 'checkout' } }).success
    ).toBe(false)
    expect(ClientHookParamsSchema.safeParse({ ...current, issuedAt: -1 }).success).toBe(false)
  })
  it('distinguishes admission from application, never a boolean success guess', () => {
    for (const state of ['accepted', 'applied'])
      expect(
        ClientHookReceiptSchema.parse({ version: 2, invocationId: legacy.invocationId, state })
      ).toHaveProperty('state', state)
    expect(
      ClientHookReceiptSchema.safeParse({
        version: 2,
        invocationId: legacy.invocationId,
        state: 'success'
      }).success
    ).toBe(false)
  })
})
