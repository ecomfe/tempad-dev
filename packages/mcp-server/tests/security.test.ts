import { describe, expect, it } from 'vitest'

import {
  createCapabilityToken,
  createExtensionOriginPolicy,
  isAllowedExtensionOrigin,
  isAllowedWebSocketRequest,
  secretsEqual
} from '../src/security'

const STORE_ORIGIN = 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
const DEV_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('mcp-server security', () => {
  it('creates unguessable URL-safe capability tokens', () => {
    const first = createCapabilityToken()
    const second = createCapabilityToken()

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second).not.toBe(first)
  })

  it('allows Chrome extension origins in compatibility mode and rejects web origins', () => {
    const policy = createExtensionOriginPolicy(undefined)

    expect(policy.mode).toBe('any-extension')
    expect(isAllowedExtensionOrigin(STORE_ORIGIN, policy)).toBe(true)
    expect(isAllowedExtensionOrigin(DEV_ORIGIN, policy)).toBe(true)
    expect(isAllowedExtensionOrigin('https://www.figma.com', policy)).toBe(false)
    expect(isAllowedExtensionOrigin(undefined, policy)).toBe(false)
  })

  it('uses an exact allowlist when configured and fails closed on malformed entries', () => {
    const policy = createExtensionOriginPolicy(` ${STORE_ORIGIN.toUpperCase()} `)

    expect(policy.mode).toBe('exact')
    expect([...policy.exactOrigins]).toEqual([STORE_ORIGIN])
    expect(isAllowedExtensionOrigin(STORE_ORIGIN, policy)).toBe(true)
    expect(isAllowedExtensionOrigin(DEV_ORIGIN, policy)).toBe(false)
    expect(() => createExtensionOriginPolicy(`${STORE_ORIGIN},https://example.com`)).toThrow(
      'Invalid allowed extension Origin: https://example.com'
    )
  })

  it('requires the legacy root WebSocket endpoint without query parameters', () => {
    const policy = createExtensionOriginPolicy(undefined)

    expect(isAllowedWebSocketRequest(STORE_ORIGIN, '/', policy)).toBe(true)
    expect(isAllowedWebSocketRequest(STORE_ORIGIN, '/?token=leak', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(STORE_ORIGIN, '/provider', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(STORE_ORIGIN, '//evil.example', policy)).toBe(false)
    expect(isAllowedWebSocketRequest('https://evil.example', '/', policy)).toBe(false)
    expect(isAllowedWebSocketRequest(STORE_ORIGIN, undefined, policy)).toBe(false)
  })

  it('compares capability values without accepting prefixes', () => {
    expect(secretsEqual('same-token', 'same-token')).toBe(true)
    expect(secretsEqual('same', 'same-token')).toBe(false)
    expect(secretsEqual('different-', 'same-token')).toBe(false)
  })
})
