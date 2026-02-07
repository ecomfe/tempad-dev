import {
  MCP_ASSET_TTL_MS,
  MCP_AUTO_ACTIVATE_GRACE_MS,
  MCP_MAX_ASSET_BYTES,
  MCP_MAX_PAYLOAD_BYTES,
  MCP_PORT_CANDIDATES,
  MCP_TOOL_TIMEOUT_MS
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it } from 'vitest'

import { getMcpServerConfig } from '../src/config'

const ENV_KEYS = [
  'TEMPAD_MCP_TOOL_TIMEOUT',
  'TEMPAD_MCP_AUTO_ACTIVATE_GRACE',
  'TEMPAD_MCP_MAX_ASSET_BYTES',
  'TEMPAD_MCP_ASSET_TTL_MS'
] as const

const originalEnv = new Map<string, string | undefined>()
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key])
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key)
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe('mcp-server/config getMcpServerConfig', () => {
  it('uses shared defaults when env overrides are missing', () => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
      maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
      autoActivateGraceMs: MCP_AUTO_ACTIVATE_GRACE_MS,
      maxAssetSizeBytes: MCP_MAX_ASSET_BYTES,
      assetTtlMs: MCP_ASSET_TTL_MS
    })
  })

  it('parses valid positive and non-negative integer overrides', () => {
    process.env.TEMPAD_MCP_TOOL_TIMEOUT = '22000'
    process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE = '3333'
    process.env.TEMPAD_MCP_MAX_ASSET_BYTES = '9999'
    process.env.TEMPAD_MCP_ASSET_TTL_MS = '0'

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: 22000,
      maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
      autoActivateGraceMs: 3333,
      maxAssetSizeBytes: 9999,
      assetTtlMs: 0
    })
  })

  it('falls back for invalid env values', () => {
    process.env.TEMPAD_MCP_TOOL_TIMEOUT = '-1'
    process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE = 'abc'
    process.env.TEMPAD_MCP_MAX_ASSET_BYTES = '0'
    process.env.TEMPAD_MCP_ASSET_TTL_MS = '-2'

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
      maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
      autoActivateGraceMs: MCP_AUTO_ACTIVATE_GRACE_MS,
      maxAssetSizeBytes: MCP_MAX_ASSET_BYTES,
      assetTtlMs: MCP_ASSET_TTL_MS
    })
  })
})
