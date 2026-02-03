export const MCP_PORT_CANDIDATES = [6220, 7431, 8127]

// Upper bound for MCP message payloads in bytes.
export const MCP_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

// Default tool timeout used by the MCP hub (ms).
export const MCP_TOOL_TIMEOUT_MS = 15000

// Grace period before auto-activating the sole extension (ms).
export const MCP_AUTO_ACTIVATE_GRACE_MS = 1500

// Maximum allowed size for uploaded assets (bytes).
export const MCP_MAX_ASSET_BYTES = 8 * 1024 * 1024
// Default asset TTL before cleanup (ms). Set to 0 to disable.
export const MCP_ASSET_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const MCP_ASSET_RESOURCE_NAME = 'tempad-assets'
export const MCP_ASSET_URI_PREFIX = 'asset://tempad/'
export const MCP_ASSET_URI_TEMPLATE = `${MCP_ASSET_URI_PREFIX}{hash}`

export const MCP_HASH_HEX_LENGTH = 8
export const MCP_HASH_PATTERN = new RegExp(`^[a-f0-9]{${MCP_HASH_HEX_LENGTH}}$`, 'i')
