import {
  MCP_AUTO_ACTIVATE_GRACE_MS,
  MCP_ASSET_TTL_MS,
  MCP_MAX_ASSET_BYTES,
  MCP_MAX_ASSET_STORE_BYTES,
  MCP_MAX_CONCURRENT_ASSET_UPLOADS,
  MCP_MAX_EXTENSION_CONNECTIONS,
  MCP_MAX_PAYLOAD_BYTES,
  MCP_PORT_CANDIDATES,
  MCP_TOOL_TIMEOUT_MS
} from '@tempad-dev/shared'

function parsePositiveInt(envValue: string | undefined, fallback: number): number {
  const parsed = envValue ? Number.parseInt(envValue, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseNonNegativeInt(envValue: string | undefined, fallback: number): number {
  const parsed = envValue ? Number.parseInt(envValue, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function resolveToolTimeoutMs(): number {
  return parsePositiveInt(process.env.TEMPAD_MCP_TOOL_TIMEOUT, MCP_TOOL_TIMEOUT_MS)
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

export function getMcpServerConfig() {
  return {
    wsPortCandidates: [...MCP_PORT_CANDIDATES],
    toolTimeoutMs: resolveToolTimeoutMs(),
    maxPayloadBytes: MCP_MAX_PAYLOAD_BYTES,
    autoActivateGraceMs: resolveAutoActivateGraceMs(),
    maxAssetSizeBytes: resolveMaxAssetSizeBytes(),
    maxAssetStoreBytes: resolveMaxAssetStoreBytes(),
    maxConcurrentAssetUploads: resolveMaxConcurrentAssetUploads(),
    maxExtensionConnections: resolveMaxExtensionConnections(),
    allowedExtensionOrigins: process.env.TEMPAD_MCP_ALLOWED_EXTENSION_ORIGINS,
    assetTtlMs: resolveAssetTtlMs()
  }
}
