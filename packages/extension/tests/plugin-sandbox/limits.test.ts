import { describe, expect, it } from 'vitest'

import { inspectSandboxValue, PLUGIN_SANDBOX_LIMITS } from '@/plugin-sandbox/limits'

describe('plugin sandbox payload limits', () => {
  it('accepts bounded plain structured-clone values', () => {
    const shared = { value: 'ok' }

    expect(
      inspectSandboxValue({
        list: [null, undefined, true, 1, 'text', shared],
        shared
      })
    ).toMatchObject({ ok: true })
  })

  it('rejects cycles and unsupported runtime values', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(inspectSandboxValue(cyclic)).toEqual({ ok: false, reason: 'invalid-payload' })
    expect(inspectSandboxValue({ value: Number.NaN })).toEqual({
      ok: false,
      reason: 'invalid-payload'
    })
    expect(inspectSandboxValue({ value: new Date(0) })).toEqual({
      ok: false,
      reason: 'invalid-payload'
    })
    expect(inspectSandboxValue({ value: () => undefined })).toEqual({
      ok: false,
      reason: 'invalid-payload'
    })
  })

  it('bounds bytes before encoding an oversized string', () => {
    const value = 'x'.repeat(PLUGIN_SANDBOX_LIMITS.maxPayloadBytes + 1)

    expect(inspectSandboxValue(value)).toEqual({
      ok: false,
      reason: 'payload-too-large'
    })
  })

  it('checks enumerable array properties preserved by structured clone', () => {
    const withMetadata = structuredClone(Object.assign(['ok'], { metadata: { value: true } }))
    expect(inspectSandboxValue(withMetadata)).toMatchObject({ ok: true })

    const oversized = Object.assign([], {
      metadata: 'x'.repeat(PLUGIN_SANDBOX_LIMITS.maxPayloadBytes + 1)
    })
    expect(inspectSandboxValue(structuredClone(oversized))).toEqual({
      ok: false,
      reason: 'payload-too-large'
    })

    const cyclic: unknown[] & { metadata?: unknown } = []
    cyclic.metadata = cyclic
    expect(inspectSandboxValue(structuredClone(cyclic))).toEqual({
      ok: false,
      reason: 'invalid-payload'
    })
  })

  it('bounds repeated-reference graphs by the work their consumers must traverse', () => {
    let value: unknown = 'leaf'
    for (let depth = 0; depth < 20; depth += 1) value = [value, value]
    expect(inspectSandboxValue(structuredClone(value))).toEqual({
      ok: false,
      reason: 'payload-too-large'
    })
  })

  it('bounds nesting depth and entry count', () => {
    let nested: Record<string, unknown> = {}
    for (let depth = 0; depth <= PLUGIN_SANDBOX_LIMITS.maxPayloadDepth; depth += 1) {
      nested = { nested }
    }

    expect(inspectSandboxValue(nested)).toEqual({
      ok: false,
      reason: 'payload-too-large'
    })
    expect(
      inspectSandboxValue(Array(PLUGIN_SANDBOX_LIMITS.maxPayloadEntries + 1).fill(null))
    ).toEqual({
      ok: false,
      reason: 'payload-too-large'
    })
  })
})
