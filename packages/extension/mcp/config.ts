const SERVER_NAME = 'tempad-dev'
const SERVER_COMMAND = 'npx'
const SERVER_ARGS = ['-y', '@tempad-dev/mcp@latest']

type BaseCommandConfig = {
  command: string
  args: string[]
}

const stdioConfig = {
  type: 'stdio' as const,
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}

const cursorConfig: BaseCommandConfig = {
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}

function toBase64(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(input)
  }
  throw new Error('Base64 encoding not supported in this environment.')
}

const vscodeDeepLink = (() => {
  const payload = {
    name: SERVER_NAME,
    ...stdioConfig
  }
  const encoded = encodeURIComponent(JSON.stringify(payload))
  return `vscode:mcp/install?${encoded}`
})()

const cursorDeepLink = (() => {
  const name = encodeURIComponent(SERVER_NAME)
  const configBase64 = toBase64(JSON.stringify(cursorConfig))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${name}&config=${configBase64}`
})()

const traeDeepLink = (() => {
  const type = 'stdio'
  const name = encodeURIComponent(SERVER_NAME)
  const configBase64 = encodeURIComponent(toBase64(JSON.stringify(cursorConfig)))
  return `trae-cn://trae.ai-ide/mcp-import?type=${type}&name=${name}&config=${configBase64}`
})()

const traeDeepLinkIntl = (() => {
  const type = 'stdio'
  const name = encodeURIComponent(SERVER_NAME)
  const configBase64 = encodeURIComponent(toBase64(JSON.stringify(cursorConfig)))
  return `trae://trae.ai-ide/mcp-import?type=${type}&name=${name}&config=${configBase64}`
})()

const windsurfConfigSnippet = JSON.stringify(
  {
    mcpServers: {
      [SERVER_NAME]: cursorConfig
    }
  },
  null,
  2
)

const claudeCliCommand = `claude mcp add --transport stdio "${SERVER_NAME}" -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`
const codexCliCommand = `codex mcp add "${SERVER_NAME}" -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`

export type McpClientId = 'vscode' | 'cursor' | 'windsurf' | 'claude' | 'codex' | 'trae'

export type McpBrandColor = string | [light: string, dark: string]

export type McpClientConfig = {
  id: McpClientId
  name: string
  brandColor?: McpBrandColor
  deepLink?: string
  supportsDeepLink: boolean
  fallbackDeepLink?: string
  copyText?: string
  copyKind?: 'command' | 'config'
}

export const MCP_CLIENTS: McpClientConfig[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    brandColor: '#0098ff',
    supportsDeepLink: true,
    deepLink: vscodeDeepLink
  },
  {
    id: 'cursor',
    name: 'Cursor',
    brandColor: ['#000', '#fff'],
    supportsDeepLink: true,
    deepLink: cursorDeepLink
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    brandColor: ['#0B100F', '#F0F3F2'],
    supportsDeepLink: false,
    copyText: windsurfConfigSnippet,
    copyKind: 'config'
  },
  {
    id: 'claude',
    name: 'Claude Code',
    brandColor: '#D97757',
    supportsDeepLink: false,
    copyText: claudeCliCommand,
    copyKind: 'command'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    brandColor: ['#0d0d0d', '#fff'],
    supportsDeepLink: false,
    copyText: codexCliCommand,
    copyKind: 'command'
  },
  {
    id: 'trae',
    name: 'TRAE',
    brandColor: ['#0fdc78', '#32f08c'],
    supportsDeepLink: true,
    deepLink: traeDeepLinkIntl,
    fallbackDeepLink: traeDeepLink
  }
]

export const MCP_CLIENTS_BY_ID = MCP_CLIENTS.reduce<Record<McpClientId, McpClientConfig>>(
  (acc, client) => {
    acc[client.id] = client
    return acc
  },
  {} as Record<McpClientId, McpClientConfig>
)

export const MCP_SERVER = {
  name: SERVER_NAME,
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}
