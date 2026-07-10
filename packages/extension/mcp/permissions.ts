export const MCP_LOCAL_HOST_ORIGIN = 'http://127.0.0.1/*'
export const MCP_PERMISSION_REQUEST_EVENT = 'tempad:mcp-request-local-host-permission'
export const MCP_PERMISSION_MESSAGE_SOURCE = 'tempad-dev:mcp-permissions'

export const MCP_LOCAL_HOST_PERMISSION_ERROR =
  'Local host permission is required before MCP can connect.'

export type McpPermissionMessageType = 'mcp.permissions.contains' | 'mcp.permissions.request'

export type McpPermissionMessage = {
  source: typeof MCP_PERMISSION_MESSAGE_SOURCE
  type: McpPermissionMessageType
}

export type McpPermissionResponse = {
  granted: boolean
}

export function createMcpPermissionMessage(type: McpPermissionMessageType): McpPermissionMessage {
  return {
    source: MCP_PERMISSION_MESSAGE_SOURCE,
    type
  }
}

export function isMcpPermissionMessage(message: unknown): message is McpPermissionMessage {
  if (!message || typeof message !== 'object') return false
  const candidate = message as Partial<McpPermissionMessage>
  return (
    candidate.source === MCP_PERMISSION_MESSAGE_SOURCE &&
    (candidate.type === 'mcp.permissions.contains' || candidate.type === 'mcp.permissions.request')
  )
}

export function isMcpPermissionResponse(response: unknown): response is McpPermissionResponse {
  if (!response || typeof response !== 'object') return false
  return typeof (response as Partial<McpPermissionResponse>).granted === 'boolean'
}
