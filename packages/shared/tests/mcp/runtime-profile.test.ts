import { describe, expect, it } from 'vitest'

import {
  RuntimeProfileSchema,
  RegisteredMessageSchema,
  RuntimeHelloMessageSchema,
  runtimePortCandidates,
  sameRuntimeProfile
} from '../../src/mcp/protocol'

describe('runtime profile contract', () => {
  const checkout = { kind: 'checkout' as const, id: 'a'.repeat(16) }
  it('keeps missing identity as release and separates checkout pools', () => {
    expect(sameRuntimeProfile(undefined, { kind: 'release' })).toBe(true)
    expect(sameRuntimeProfile(checkout, undefined)).toBe(false)
    expect(sameRuntimeProfile(undefined, checkout)).toBe(false)
    expect(sameRuntimeProfile(checkout, { ...checkout })).toBe(true)
    expect(sameRuntimeProfile(checkout, { ...checkout, id: 'b'.repeat(16) })).toBe(false)
    expect(runtimePortCandidates()).toEqual([6220, 7431, 8127])
    expect(
      runtimePortCandidates(checkout).filter((port) => runtimePortCandidates().includes(port))
    ).toEqual([])
  })

  it.each([
    { kind: 'pinned' },
    { kind: 'checkout', id: '../release' },
    { kind: 'release', id: 'x' }
  ])('rejects invalid profile %j', (profile) => {
    expect(RuntimeProfileSchema.safeParse(profile).success).toBe(false)
  })

  it('extends only the optional envelope identity and keeps released messages valid', () => {
    const registration = { type: 'registered', id: 'hub', protocolVersion: 15 }
    const hello = {
      type: 'runtimeHello',
      protocolVersion: 15,
      extensionVersion: '1',
      extensionRuntimeFingerprint: 'a'.repeat(64)
    }
    for (const [schema, message] of [
      [RegisteredMessageSchema, registration],
      [RuntimeHelloMessageSchema, hello]
    ] as const) {
      expect(schema.parse(message)).toEqual(message)
      expect(schema.parse({ ...message, runtimeProfile: checkout })).toEqual({
        ...message,
        runtimeProfile: checkout
      })
      expect(schema.safeParse({ ...message, runtimeProfile: { kind: 'unknown' } }).success).toBe(
        false
      )
    }
  })
})
