const SERVER_NAME = 'tempad-dev'
const SERVER_COMMAND = 'npx'
const SERVER_ARGS = ['-y', '@tempad-dev/mcp@latest']

type BaseCommandConfig = {
  command: string
  args: string[]
}

type StdioCommandConfig = BaseCommandConfig & {
  type: 'stdio'
}

const stdioConfig: StdioCommandConfig = {
  type: 'stdio',
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}

const cursorConfig: BaseCommandConfig = {
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}

const encodedServerName = encodeURIComponent(SERVER_NAME)
const cursorConfigJson = JSON.stringify(cursorConfig)
const cursorConfigBase64 = toBase64(cursorConfigJson)
const encodedCursorConfigBase64 = encodeURIComponent(cursorConfigBase64)

function toBase64(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(input)
  }
  throw new Error('Base64 encoding not supported in this environment.')
}

function buildVscodeDeepLink(): string {
  const payload = {
    name: SERVER_NAME,
    ...stdioConfig
  }
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify(payload))}`
}

function buildCursorDeepLink(): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodedServerName}&config=${encodedCursorConfigBase64}`
}

function buildTraeDeepLink(protocol: 'trae' | 'trae-cn'): string {
  const type = 'stdio'
  return `${protocol}://trae.ai-ide/mcp-import?type=${type}&name=${encodedServerName}&config=${encodedCursorConfigBase64}`
}

const vscodeDeepLink = buildVscodeDeepLink()
const cursorDeepLink = buildCursorDeepLink()
const traeDeepLink = buildTraeDeepLink('trae-cn')
const traeDeepLinkIntl = buildTraeDeepLink('trae')

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

export const MCP_CLIENTS_BY_ID: Record<McpClientId, McpClientConfig> = {
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    brandColor: '#0098ff',
    supportsDeepLink: true,
    deepLink: vscodeDeepLink
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    brandColor: ['#000', '#fff'],
    supportsDeepLink: true,
    deepLink: cursorDeepLink
  },
  windsurf: {
    id: 'windsurf',
    name: 'Windsurf',
    brandColor: ['#0B100F', '#F0F3F2'],
    supportsDeepLink: false,
    copyText: windsurfConfigSnippet,
    copyKind: 'config'
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    brandColor: '#D97757',
    supportsDeepLink: false,
    copyText: claudeCliCommand,
    copyKind: 'command'
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    brandColor: ['#0d0d0d', '#fff'],
    supportsDeepLink: false,
    copyText: codexCliCommand,
    copyKind: 'command'
  },
  trae: {
    id: 'trae',
    name: 'TRAE',
    brandColor: ['#0fdc78', '#32f08c'],
    supportsDeepLink: true,
    deepLink: traeDeepLinkIntl,
    fallbackDeepLink: traeDeepLink
  }
}

export const MCP_CLIENTS: McpClientConfig[] = [
  MCP_CLIENTS_BY_ID.vscode,
  MCP_CLIENTS_BY_ID.cursor,
  MCP_CLIENTS_BY_ID.windsurf,
  MCP_CLIENTS_BY_ID.claude,
  MCP_CLIENTS_BY_ID.codex,
  MCP_CLIENTS_BY_ID.trae
]

export const MCP_SERVER = {
  name: SERVER_NAME,
  command: SERVER_COMMAND,
  args: SERVER_ARGS
}
