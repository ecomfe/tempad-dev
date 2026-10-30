import {
  MCP_APPLY_CANVAS_TIMEOUT_MS,
  MCP_AUTO_ACTIVATE_GRACE_MS,
  MCP_ASSET_TTL_MS,
  MCP_MAX_ASSET_BYTES,
  MCP_MAX_ASSET_STORE_BYTES,
  MCP_MAX_CONCURRENT_ASSET_UPLOADS,
  MCP_MAX_EXTENSION_CONNECTIONS,
  MCP_MAX_PAYLOAD_BYTES,
  runtimePortCandidates,
  type RuntimeProfile,
  MCP_GET_CODE_TIMEOUT_MS,
  MCP_GET_DESIGN_SYSTEM_TIMEOUT_MS,
  MCP_TOOL_TIMEOUT_MS
} from '@tempad-dev/shared'

// An explicit get_structure page read may have to load a cold Figma page first.
const PAGE_STRUCTURE_TIMEOUT_MS = 45000

function boundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max = 2 ** 31 - 1
) {
  const parsed = value?.trim() ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

export function getRuntimeTimingConfig(env: NodeJS.ProcessEnv = process.env) {
  // Match proper-lockfile's minimum stale/update intervals, and keep renewal
  // inside the lease even when only its expiry is overridden.
  const hubLockStaleMs = boundedInteger(env.TEMPAD_MCP_HUB_LOCK_STALE_MS, 60000, 2000)
  const hubLockUpdateMs = boundedInteger(
    env.TEMPAD_MCP_HUB_LOCK_UPDATE_MS,
    Math.min(10000, Math.floor(hubLockStaleMs / 2)),
    1000,
    Math.floor(hubLockStaleMs / 2)
  )
  const controlLeaseMs = boundedInteger(env.TEMPAD_MCP_CONTROL_LEASE_MS, 10000, 100)
  const controlRenewMs = boundedInteger(
    env.TEMPAD_MCP_CONTROL_RENEW_MS,
    Math.min(2000, Math.floor(controlLeaseMs / 2)),
    1,
    Math.floor(controlLeaseMs / 2)
  )
  return {
    hubLockStaleMs,
    hubLockUpdateMs,
    controlLeaseMs,
    controlRenewMs,
    automaticIdleMs: boundedInteger(env.TEMPAD_MCP_RUNTIME_AUTO_IDLE_MS, 5000, 1)
  }
}

function parsePositiveInt(envValue: string | undefined, fallback: number): number {
  const parsed = envValue ? Number.parseInt(envValue, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInt(envValue: string | undefined, fallback: number): number {
  const parsed = envValue ? Number.parseInt(envValue, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveToolTimeoutMs(specializedValue?: string, fallback = MCP_TOOL_TIMEOUT_MS): number {
  const general = parsePositiveInt(process.env.TEMPAD_MCP_TOOL_TIMEOUT, fallback)
  return parsePositiveInt(specializedValue, general)
}

function resolveAutoActivateGraceMs(): number {
  return parsePositiveInt(process.env.TEMPAD_MCP_AUTO_ACTIVATE_GRACE, MCP_AUTO_ACTIVATE_GRACE_MS)
}

function resolveMaxAssetSizeBytes(): number {
  return parsePositiveInt(process.env.TEMPAD_MCP_MAX_ASSET_BYTES, MCP_MAX_ASSET_BYTES)
}

function resolveAssetTtlMs(): number {
  return parseNonNegativeInt(process.env.TEMPAD_MCP_ASSET_TTL_MS, MCP_ASSET_TTL_MS)
}

function resolveMaxAssetStoreBytes(): number {
  return parsePositiveInt(process.env.TEMPAD_MCP_MAX_ASSET_STORE_BYTES, MCP_MAX_ASSET_STORE_BYTES)
}

function resolveMaxConcurrentAssetUploads(): number {
  return parsePositiveInt(
    process.env.TEMPAD_MCP_MAX_CONCURRENT_ASSET_UPLOADS,
    MCP_MAX_CONCURRENT_ASSET_UPLOADS
  )
}

function resolveMaxExtensionConnections(): number {
  return parsePositiveInt(
    process.env.TEMPAD_MCP_MAX_EXTENSION_CONNECTIONS,
    MCP_MAX_EXTENSION_CONNECTIONS
  )
}

export function getMcpServerConfig(profile?: RuntimeProfile) {
  return {
    wsPortCandidates: [...runtimePortCandidates(profile)],
    toolTimeoutMs: resolveToolTimeoutMs(),
    getCodeTimeoutMs: resolveToolTimeoutMs(
      process.env.TEMPAD_MCP_GET_CODE_TIMEOUT,
      MCP_GET_CODE_TIMEOUT_MS
    ),
    getDesignSystemTimeoutMs: resolveToolTimeoutMs(
      process.env.TEMPAD_MCP_GET_DESIGN_SYSTEM_TIMEOUT,
      MCP_GET_DESIGN_SYSTEM_TIMEOUT_MS
    ),
    pageStructureTimeoutMs: resolveToolTimeoutMs(
      process.env.TEMPAD_MCP_PAGE_STRUCTURE_TIMEOUT,
      PAGE_STRUCTURE_TIMEOUT_MS
    ),
    applyCanvasTimeoutMs: resolveToolTimeoutMs(
      process.env.TEMPAD_MCP_APPLY_CANVAS_TIMEOUT,
      MCP_APPLY_CANVAS_TIMEOUT_MS
    ),
    maxPayloadBytes: boundedInteger(
      process.env.TEMPAD_MCP_MAX_PAYLOAD_BYTES,
      MCP_MAX_PAYLOAD_BYTES,
      1,
      MCP_MAX_PAYLOAD_BYTES
    ),
    autoActivateGraceMs: resolveAutoActivateGraceMs(),
    maxAssetSizeBytes: resolveMaxAssetSizeBytes(),
    maxAssetStoreBytes: resolveMaxAssetStoreBytes(),
    maxConcurrentAssetUploads: resolveMaxConcurrentAssetUploads(),
    maxExtensionConnections: resolveMaxExtensionConnections(),
    allowedExtensionOrigins: process.env.TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS,
    assetTtlMs: resolveAssetTtlMs()
  }
}
