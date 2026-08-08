import { describe, expect, it } from 'vitest'

import {
  MCP_APPLY_CANVAS_TIMEOUT_MS,
  MCP_ASSET_TTL_MS,
  MCP_HASH_HEX_LENGTH,
  MCP_HASH_PATTERN,
  MCP_LEGACY_HASH_HEX_LENGTH,
  MCP_GET_CODE_TIMEOUT_MS,
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
    expect(MCP_GET_CODE_TIMEOUT_MS).toBe(30000)
    expect(MCP_APPLY_CANVAS_TIMEOUT_MS).toBe(120000)
    expect(MCP_MAX_ASSET_BYTES).toBe(8 * 1024 * 1024)
    expect(MCP_MAX_ASSET_STORE_BYTES).toBe(256 * 1024 * 1024)
    expect(MCP_MAX_CONCURRENT_ASSET_UPLOADS).toBe(4)
    expect(MCP_MAX_EXTENSION_CONNECTIONS).toBe(16)
    expect(MCP_ASSET_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('exposes stable hash matcher metadata', () => {
    expect(MCP_HASH_HEX_LENGTH).toBe(64)
    expect(MCP_LEGACY_HASH_HEX_LENGTH).toBe(8)

    expect(MCP_HASH_PATTERN.test('a'.repeat(64))).toBe(true)
    expect(MCP_HASH_PATTERN.test('a'.repeat(8))).toBe(true)
    expect(MCP_HASH_PATTERN.test('A'.repeat(64))).toBe(false)
    expect(MCP_HASH_PATTERN.test('a'.repeat(9))).toBe(false)
    expect(MCP_HASH_PATTERN.test('bad')).toBe(false)
    expect(MCP_HASH_PATTERN.test('a'.repeat(65))).toBe(false)
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
      CANVAS_READ_ONLY: 'CANVAS_READ_ONLY',
      CANVAS_UNSUPPORTED_EDITOR: 'CANVAS_UNSUPPORTED_EDITOR',
      CANVAS_BUSY: 'CANVAS_BUSY',
      INVALID_CANVAS_SCOPE: 'INVALID_CANVAS_SCOPE',
      INVALID_CANVAS_SPEC: 'INVALID_CANVAS_SPEC',
      CANVAS_APPLY_FAILED: 'CANVAS_APPLY_FAILED',
      ASSET_SERVER_NOT_CONFIGURED: 'ASSET_SERVER_NOT_CONFIGURED',
      ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
      ASSET_HASH_MISMATCH: 'ASSET_HASH_MISMATCH',
      ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
      ASSET_MIME_UNSUPPORTED: 'ASSET_MIME_UNSUPPORTED',
      ASSET_BRIDGE_UNAVAILABLE: 'ASSET_BRIDGE_UNAVAILABLE',
      SVG_INVALID: 'SVG_INVALID',
      SVG_EXTERNAL_REFERENCE: 'SVG_EXTERNAL_REFERENCE',
      SVG_TOO_COMPLEX: 'SVG_TOO_COMPLEX',
      SVG_IMPORT_FAILED: 'SVG_IMPORT_FAILED',
      SVG_WRAPPER_DIRTY: 'SVG_WRAPPER_DIRTY',
      IMAGE_IMPORT_FAILED: 'IMAGE_IMPORT_FAILED',
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
