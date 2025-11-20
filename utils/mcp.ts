export type McpClientId =
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'claude'
  | 'trae'
  | 'zed'
  | 'cline'

export type McpClientConfig = {
  id: McpClientId
  name: string
  hoverColor?: string
  deepLink?: string
  supportsDeepLink: boolean
}

export const MCP_CLIENTS: McpClientConfig[] = [
  { id: 'vscode', name: 'VS Code', supportsDeepLink: true, deepLink: 'vscode://' },
  { id: 'cursor', name: 'Cursor', supportsDeepLink: true, deepLink: 'cursor://' },
  { id: 'windsurf', name: 'Windsurf', supportsDeepLink: true, deepLink: 'windsurf://' },
  { id: 'claude', name: 'Claude', supportsDeepLink: false },
  { id: 'trae', name: 'TRAE', supportsDeepLink: false },
  { id: 'zed', name: 'Zed', supportsDeepLink: true, deepLink: 'zed://' },
  { id: 'cline', name: 'Cline', supportsDeepLink: false }
]

export const MCP_CLIENTS_BY_ID = MCP_CLIENTS.reduce<Record<McpClientId, McpClientConfig>>(
  (acc, client) => {
    acc[client.id] = client
    return acc
  },
  {} as Record<McpClientId, McpClientConfig>
)
