const SERVER_NAME = 'tempad-dev'
const SERVER_COMMAND = 'npx'
const SERVER_ARGS = ['-y', '@tempad-dev/mcp@latest'] as const

const SKILL_INSTALL_COMMAND = 'npx skills add https://github.com/ecomfe/tempad-dev/tree/main/skill'

type BaseCommandConfig = {
  command: string
  args: string[]
}

type StdioCommandConfig = BaseCommandConfig & {
  type: 'stdio'
}

export type McpClientId = 'vscode' | 'cursor' | 'windsurf' | 'claude' | 'codex' | 'trae'

export type McpBrandColor = string | [light: string, dark: string]
export type McpClientCopyKind = 'command' | 'config'
export type McpClientCopyVariant = 'primary' | 'alternate'
export type McpClientCopyPayload = {
  kind: McpClientCopyKind
  text: string
}

export type McpClientConfig = {
  id: McpClientId
  name: string
  brandColor?: McpBrandColor
  deepLink?: string
  supportsDeepLink: boolean
  fallbackDeepLink?: string
  copyText?: string
  copyKind?: McpClientCopyKind
  alternateCopyText?: string
  alternateCopyKind?: McpClientCopyKind
}

const stdioConfig: StdioCommandConfig = {
  type: 'stdio',
  command: SERVER_COMMAND,
  args: [...SERVER_ARGS]
}

const commandConfig: BaseCommandConfig = {
  command: SERVER_COMMAND,
  args: [...SERVER_ARGS]
}

type BufferLike = {
  from(
    input: string,
    encoding: 'utf8'
  ): {
    toString(encoding: 'base64'): string
  }
}

function toBase64(input: string): string {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(input)
  }

  const bufferLike = (globalThis as { Buffer?: BufferLike }).Buffer

  if (bufferLike) {
    return bufferLike.from(input, 'utf8').toString('base64')
  }

  throw new Error('Base64 encoding not supported in this environment.')
}

function buildVscodeDeepLink(): string {
  return `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({
      name: SERVER_NAME,
      ...stdioConfig
    })
  )}`
}

function buildCursorConfigBase64(): string {
  return encodeURIComponent(toBase64(JSON.stringify(commandConfig)))
}

function buildCursorDeepLink(): string {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
    SERVER_NAME
  )}&config=${buildCursorConfigBase64()}`
}

function buildTraeDeepLink(protocol: 'trae' | 'trae-cn'): string {
  return `${protocol}://trae.ai-ide/mcp-import?type=stdio&name=${encodeURIComponent(
    SERVER_NAME
  )}&config=${buildCursorConfigBase64()}`
}

function buildWindsurfConfigSnippet(): string {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: commandConfig
      }
    },
    null,
    2
  )
}

function buildCodexConfigSnippet(): string {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(SERVER_COMMAND)}`,
    `args = [${SERVER_ARGS.map((arg) => JSON.stringify(arg)).join(', ')}]`
  ].join('\n')
}

function buildCliCommand(prefix: 'claude' | 'codex'): string {
  const args = `${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`
  if (prefix === 'claude') {
    return `claude mcp add --transport stdio "${SERVER_NAME}" -- ${args}`
  }

  return `codex mcp add "${SERVER_NAME}" -- ${args}`
}

export function getMcpClientCopyPayload(
  client: Pick<
    McpClientConfig,
    'copyText' | 'copyKind' | 'alternateCopyText' | 'alternateCopyKind'
  >,
  variant: McpClientCopyVariant = 'primary'
): McpClientCopyPayload | null {
  if (variant === 'alternate' && client.alternateCopyText && client.alternateCopyKind) {
    return {
      text: client.alternateCopyText,
      kind: client.alternateCopyKind
    }
  }

  if (!client.copyText) return null
  return {
    text: client.copyText,
    kind: client.copyKind === 'config' ? 'config' : 'command'
  }
}

export function getNextMcpClientCopyVariant(
  client: Pick<McpClientConfig, 'alternateCopyText' | 'alternateCopyKind'>,
  currentVariant: McpClientCopyVariant = 'primary'
): McpClientCopyVariant {
  if (!client.alternateCopyText || !client.alternateCopyKind) {
    return 'primary'
  }

  return currentVariant === 'alternate' ? 'primary' : 'alternate'
}

export const MCP_SERVER = {
  name: SERVER_NAME,
  command: SERVER_COMMAND,
  args: [...SERVER_ARGS]
}

export const MCP_DEFAULT_CONFIG_SNIPPET = JSON.stringify(
  {
    [SERVER_NAME]: commandConfig
  },
  null,
  2
)

export const MCP_SKILL_INSTALL_COMMAND = SKILL_INSTALL_COMMAND

export const MCP_CLIENTS_BY_ID: Record<McpClientId, McpClientConfig> = {
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    brandColor: '#0098ff',
    supportsDeepLink: true,
    deepLink: buildVscodeDeepLink()
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    brandColor: ['#000', '#fff'],
    supportsDeepLink: true,
    deepLink: buildCursorDeepLink()
  },
  windsurf: {
    id: 'windsurf',
    name: 'Windsurf',
    brandColor: ['#0B100F', '#F0F3F2'],
    supportsDeepLink: false,
    copyText: buildWindsurfConfigSnippet(),
    copyKind: 'config'
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    brandColor: '#D97757',
    supportsDeepLink: false,
    copyText: buildCliCommand('claude'),
    copyKind: 'command'
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    brandColor: ['#0d0d0d', '#fff'],
    supportsDeepLink: false,
    copyText: buildCliCommand('codex'),
    copyKind: 'command',
    alternateCopyText: buildCodexConfigSnippet(),
    alternateCopyKind: 'config'
  },
  trae: {
    id: 'trae',
    name: 'TRAE',
    brandColor: ['#0fdc78', '#32f08c'],
    supportsDeepLink: true,
    deepLink: buildTraeDeepLink('trae'),
    fallbackDeepLink: buildTraeDeepLink('trae-cn')
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
