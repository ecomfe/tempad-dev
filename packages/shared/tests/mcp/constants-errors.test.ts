import { describe, expect, it } from 'vitest'

import {
  MCP_ASSET_TTL_MS,
  MCP_HASH_HEX_LENGTH,
  MCP_HASH_PATTERN,
  MCP_MAX_ASSET_BYTES,
  MCP_MAX_ASSET_STORE_BYTES,
  MCP_MAX_CONCURRENT_ASSET_UPLOADS,
  MCP_MAX_EXTENSION_CONNECTIONS,
  MCP_MAX_PAYLOAD_BYTES,
  MCP_TOOL_INLINE_BUDGET_BYTES,
  MCP_TOOL_TIMEOUT_MS
} from '../../src/mcp/constants'
import { TEMPAD_MCP_ERROR_CODES, TempadMcpErrorPayloadSchema } from '../../src/mcp/errors'

describe('mcp/constants', () => {
  it('exposes stable numeric defaults', () => {
    expect(MCP_MAX_PAYLOAD_BYTES).toBe(4 * 1024 * 1024)
    expect(MCP_TOOL_INLINE_BUDGET_BYTES).toBe(64 * 1024)
    expect(MCP_TOOL_TIMEOUT_MS).toBe(15000)
    expect(MCP_MAX_ASSET_BYTES).toBe(8 * 1024 * 1024)
    expect(MCP_MAX_ASSET_STORE_BYTES).toBe(256 * 1024 * 1024)
    expect(MCP_MAX_CONCURRENT_ASSET_UPLOADS).toBe(4)
    expect(MCP_MAX_EXTENSION_CONNECTIONS).toBe(16)
    expect(MCP_ASSET_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('exposes stable hash matcher metadata', () => {
    expect(MCP_HASH_HEX_LENGTH).toBe(8)

    expect(MCP_HASH_PATTERN.test('deadbeef')).toBe(true)
    expect(MCP_HASH_PATTERN.test('DEADBEEF')).toBe(true)
    expect(MCP_HASH_PATTERN.test('bad')).toBe(false)
    expect(MCP_HASH_PATTERN.test('deadbeef00')).toBe(false)
  })
})

describe('mcp/errors', () => {
  it('defines the expected extension/hub error codes', () => {
    expect(TEMPAD_MCP_ERROR_CODES).toEqual({
      NO_ACTIVE_EXTENSION: 'NO_ACTIVE_EXTENSION',
      EXTENSION_TIMEOUT: 'EXTENSION_TIMEOUT',
      EXTENSION_DISCONNECTED: 'EXTENSION_DISCONNECTED',
      INVALID_SELECTION: 'INVALID_SELECTION',
      NODE_NOT_VISIBLE: 'NODE_NOT_VISIBLE',
      ASSET_SERVER_NOT_CONFIGURED: 'ASSET_SERVER_NOT_CONFIGURED',
      TRANSPORT_NOT_CONNECTED: 'TRANSPORT_NOT_CONNECTED'
    })
  })

  it('validates the shared wire error payload', () => {
    expect(TempadMcpErrorPayloadSchema.parse({ message: 'failed' })).toEqual({
      message: 'failed'
    })
    expect(
      TempadMcpErrorPayloadSchema.parse({
        code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT,
        message: 'timed out'
      })
    ).toEqual({ code: TEMPAD_MCP_ERROR_CODES.EXTENSION_TIMEOUT, message: 'timed out' })
    expect(TempadMcpErrorPayloadSchema.safeParse({ message: '' }).success).toBe(false)
    expect(
      TempadMcpErrorPayloadSchema.safeParse({ code: 'UNKNOWN', message: 'failed' }).success
    ).toBe(false)
  })
})
