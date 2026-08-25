export const MCP_PORT_CANDIDATES = [6220, 7431, 8127]

// Bump whenever the Hub and extension must upgrade together, including shared tool-contract changes.
export const TEMPAD_MCP_BRIDGE_PROTOCOL_VERSION = 2

// Upper bound for MCP message payloads in bytes.
export const MCP_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
// Default inline budget for tool responses measured on CallToolResult bytes.
export const MCP_TOOL_INLINE_BUDGET_BYTES = 64 * 1024

// Default tool timeout used by the MCP hub (ms).
export const MCP_TOOL_TIMEOUT_MS = 15000
// Default timeout for get_code, whose bounded asset and codegen work can exceed the general limit.
export const MCP_GET_CODE_TIMEOUT_MS = 30000
// Default timeout for apply_canvas, which may import remote media before mutating the document.
export const MCP_APPLY_CANVAS_TIMEOUT_MS = 120000

// Grace period before auto-activating the sole extension (ms).
export const MCP_AUTO_ACTIVATE_GRACE_MS = 1500

// Maximum allowed size for uploaded assets (bytes).
export const MCP_MAX_ASSET_BYTES = 8 * 1024 * 1024
// Maximum aggregate size of the local asset store (bytes).
export const MCP_MAX_ASSET_STORE_BYTES = 256 * 1024 * 1024
// Maximum number of asset request bodies accepted concurrently.
export const MCP_MAX_CONCURRENT_ASSET_UPLOADS = 4
// Maximum simultaneous browser extension connections to one local Hub.
export const MCP_MAX_EXTENSION_CONNECTIONS = 16
// Default asset TTL before cleanup (ms). Set to 0 to disable.
export const MCP_ASSET_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const MCP_HASH_HEX_LENGTH = 64
export const MCP_LEGACY_HASH_HEX_LENGTH = 8
export const MCP_HASH_PATTERN = new RegExp(
  `^(?:[a-f0-9]{${MCP_HASH_HEX_LENGTH}}|[a-f0-9]{${MCP_LEGACY_HASH_HEX_LENGTH}})$`
)
