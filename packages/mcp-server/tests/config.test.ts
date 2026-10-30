import {
  MCP_APPLY_CANVAS_TIMEOUT_MS,
  MCP_ASSET_TTL_MS,
  MCP_AUTO_ACTIVATE_GRACE_MS,
  MCP_MAX_ASSET_BYTES,
  MCP_MAX_ASSET_STORE_BYTES,
  MCP_MAX_CONCURRENT_ASSET_UPLOADS,
  MCP_MAX_EXTENSION_CONNECTIONS,
  MCP_MAX_PAYLOAD_BYTES,
  MCP_PORT_CANDIDATES,
  MCP_GET_CODE_TIMEOUT_MS,
  MCP_GET_DESIGN_SYSTEM_TIMEOUT_MS,
  MCP_TOOL_TIMEOUT_MS
} from '@tempad-dev/shared'
import { afterEach, describe, expect, it } from 'vitest'

import { getMcpServerConfig, getRuntimeTimingConfig } from '../src/config'

const ENV_KEYS = [
  'TEMPAD_MCP_TOOL_TIMEOUT',
  'TEMPAD_MCP_GET_CODE_TIMEOUT',
  'TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT',
  'TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT',
  'TEMPAD_MCP_APPLY_CANVAS_TIMEOUT',
  'TEMPAD_MCP_AUTO_ACTIVATE_GRACE',
  'TEMPAD_MCP_MAX_PAYLOAD_BYTES',
  'TEMPAD_MCP_MAX_ASSET_BYTES',
  'TEMPAD_MCP_MAX_ASSET_STORE_BYTES',
  'TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS',
  'TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS',
  'TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS',
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
  it('uses defaults when env overrides are missing', () => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
      getCodeTimeoutMs: MCP_GET_CODE_TIMEOUT_MS,
      getDesignSystemTimeoutMs: MCP_GET_DESIGN_SYSTEM_TIMEOUT_MS,
      pageStructureTimeoutMs: 45000,
      applyCanvasTimeoutMs: MCP_APPLY_CANVAS_TIMEOUT_MS,
      maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
      autoActivateGraceMs: MCP_AUTO_ACTIVATE_GRACE_MS,
      maxAssetSizeBytes: MCP_MAX_ASSET_BYTES,
      maxAssetStoreBytes: MCP_MAX_ASSET_STORE_BYTES,
      maxConcurrentAssetUploads: MCP_MAX_CONCURRENT_ASSET_UPLOADS,
      maxExtensionConnections: MCP_MAX_EXTENSION_CONNECTIONS,
      allowedExtensionOrigins: undefined,
      assetTtlMs: MCP_ASSET_TTL_MS
    })
  })

  it('parses valid positive and non-negative integer overrides', () => {
    process.env.TEMPAD_MCP_TOOL_TIMEOUT = '22000'
    process.env.TEMPAD_MCP_GET_CODE_TIMEOUT = '45000'
    process.env.TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT = '48000'
    process.env.TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT = '50000'
    process.env.TEMPAD_MCP_APPLY_CANVAS_TIMEOUT = '90000'
    process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE = '3333'
    process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES = '64'
    process.env.TEMPAD_MCP_MAX_ASSET_BYTES = '9999'
    process.env.TEMPAD_MCP_MAX_ASSET_STORE_BYTES = '99999'
    process.env.TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS = '3'
    process.env.TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS = '7'
    process.env.TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS =
      'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc'
    process.env.TEMPAD_MCP_ASSET_TTL_MS = '0'

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: 22000,
      getCodeTimeoutMs: 45000,
      getDesignSystemTimeoutMs: 48000,
      pageStructureTimeoutMs: 50000,
      applyCanvasTimeoutMs: 90000,
      maxPayloadBytes: 64,
      autoActivateGraceMs: 3333,
      maxAssetSizeBytes: 9999,
      maxAssetStoreBytes: 99999,
      maxConcurrentAssetUploads: 3,
      maxExtensionConnections: 7,
      allowedExtensionOrigins: 'chrome-extension://lgoeakbaikpkihoiphamaeopmliaimpc',
      assetTtlMs: 0
    })
  })

  it('falls back for invalid env values', () => {
    process.env.TEMPAD_MCP_TOOL_TIMEOUT = '-1'
    process.env.TEMPAD_MCP_GET_CODE_TIMEOUT = '0'
    process.env.TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT = '-2'
    process.env.TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT = 'invalid'
    process.env.TEMPAD_MCP_APPLY_CANVAS_TIMEOUT = 'nope'
    process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE = 'abc'
    process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES = 'invalid'
    process.env.TEMPAD_MCP_MAX_ASSET_BYTES = '0'
    process.env.TEMPAD_MCP_MAX_ASSET_STORE_BYTES = 'nope'
    process.env.TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS = '-1'
    process.env.TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS = '0'
    process.env.TEMPAD_MCP_ASSET_TTL_MS = '-2'

    expect(getMcpServerConfig()).toEqual({
      wsPortCandidates: [...MCP_PORT_CANDIDATES],
      toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
      getCodeTimeoutMs: MCP_GET_CODE_TIMEOUT_MS,
      getDesignSystemTimeoutMs: MCP_GET_DESIGN_SYSTEM_TIMEOUT_MS,
      pageStructureTimeoutMs: 45000,
      applyCanvasTimeoutMs: MCP_APPLY_CANVAS_TIMEOUT_MS,
      maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
      autoActivateGraceMs: MCP_AUTO_ACTIVATE_GRACE_MS,
      maxAssetSizeBytes: MCP_MAX_ASSET_BYTES,
      maxAssetStoreBytes: MCP_MAX_ASSET_STORE_BYTES,
      maxConcurrentAssetUploads: MCP_MAX_CONCURRENT_ASSET_UPLOADS,
      maxExtensionConnections: MCP_MAX_EXTENSION_CONNECTIONS,
      allowedExtensionOrigins: process.env.TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS,
      assetTtlMs: MCP_ASSET_TTL_MS
    })
  })

  it('uses the general override as each specialized timeout fallback', () => {
    process.env.TEMPAD_MCP_TOOL_TIMEOUT = '22000'

    expect(getMcpServerConfig().getCodeTimeoutMs).toBe(22000)
    expect(getMcpServerConfig().getDesignSystemTimeoutMs).toBe(22000)
    expect(getMcpServerConfig().pageStructureTimeoutMs).toBe(22000)
    expect(getMcpServerConfig().applyCanvasTimeoutMs).toBe(22000)
  })
})

describe('runtime timing overrides', () => {
  it('preserves production defaults', () => {
    expect(getRuntimeTimingConfig({})).toEqual({
      hubLockStaleMs: 60000,
      hubLockUpdateMs: 10000,
      controlLeaseMs: 10000,
      controlRenewMs: 2000,
      automaticIdleMs: 5000
    })
    delete process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES
    expect(getMcpServerConfig().maxPayloadBytes).toBe(4 * 1024 * 1024)
  })

  it('keeps heartbeat intervals within smaller leases', () => {
    expect(
      getRuntimeTimingConfig({
        TEMPAD_MCP_HUB_LOCK_STALE_MS: '3000',
        TEMPAD_MCP_CONTROL_LEASE_MS: '2000',
        TEMPAD_MCP_RUNTIME_AUTO_IDLE_MS: '500'
      })
    ).toEqual({
      hubLockStaleMs: 3000,
      hubLockUpdateMs: 1500,
      controlLeaseMs: 2000,
      controlRenewMs: 1000,
      automaticIdleMs: 500
    })
    expect(
      getRuntimeTimingConfig({
        TEMPAD_MCP_HUB_LOCK_STALE_MS: '2000',
        TEMPAD_MCP_HUB_LOCK_UPDATE_MS: '2000',
        TEMPAD_MCP_CONTROL_LEASE_MS: '100',
        TEMPAD_MCP_CONTROL_RENEW_MS: '100'
      })
    ).toMatchObject({ hubLockUpdateMs: 1000, controlRenewMs: 50 })
    expect(
      getRuntimeTimingConfig({
        TEMPAD_MCP_HUB_LOCK_STALE_MS: '3000',
        TEMPAD_MCP_HUB_LOCK_UPDATE_MS: '1000',
        TEMPAD_MCP_CONTROL_LEASE_MS: '2000',
        TEMPAD_MCP_CONTROL_RENEW_MS: '200'
      })
    ).toMatchObject({ hubLockUpdateMs: 1000, controlRenewMs: 200 })
  })

  it.each(['', ' ', 'nope', '1ms', '1.5', '0', '-1', 'Infinity', '2147483648'])(
    'rejects malformed, non-positive and overflowing values: %j',
    (value) => {
      expect(
        getRuntimeTimingConfig({
          TEMPAD_MCP_HUB_LOCK_STALE_MS: value,
          TEMPAD_MCP_HUB_LOCK_UPDATE_MS: value,
          TEMPAD_MCP_CONTROL_LEASE_MS: value,
          TEMPAD_MCP_CONTROL_RENEW_MS: value,
          TEMPAD_MCP_RUNTIME_AUTO_IDLE_MS: value
        })
      ).toEqual(getRuntimeTimingConfig({}))
      process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES = value
      expect(getMcpServerConfig().maxPayloadBytes).toBe(MCP_MAX_PAYLOAD_BYTES)
    }
  )

  it('respects lockfile minimums and the shared payload ceiling', () => {
    expect(getRuntimeTimingConfig({ TEMPAD_MCP_HUB_LOCK_STALE_MS: '1999' }).hubLockStaleMs).toBe(
      60000
    )
    process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES = String(MCP_MAX_PAYLOAD_BYTES + 1)
    expect(getMcpServerConfig().maxPayloadBytes).toBe(MCP_MAX_PAYLOAD_BYTES)
    process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES = '1'
    expect(getMcpServerConfig().maxPayloadBytes).toBe(1)
  })
})
