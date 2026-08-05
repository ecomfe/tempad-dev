const SERVER_NAME = 'tempad-dev'
const SERVER_COMMAND = 'npx'
const SERVER_ARGS = ['-y', '@tempad-dev/mcp@latest'] as const
const REPOSITORY = 'ecomfe/tempad-dev'
const MARKETPLACE_NAME = 'tempad-dev'
const PLUGIN_NAME = 'tempad-dev'

const SKILLS_SOURCE_URL =
  'https://github.com/ecomfe/tempad-dev/tree/main/agent-plugins/tempad-dev/skills'
const DESIGN_TO_CODE_SKILL_NAME = 'figma-design-to-code'
const CANVAS_AUTHORING_SKILL_NAME = 'figma-canvas-authoring'
const SKILL_NAMES = [DESIGN_TO_CODE_SKILL_NAME, CANVAS_AUTHORING_SKILL_NAME] as const
const SKILLS_INSTALL_COMMAND = `npx skills add ${SKILLS_SOURCE_URL} --skill ${SKILL_NAMES.join(' ')}`

type SkillAgentId = 'cursor' | 'github-copilot' | 'opencode' | 'trae'

type BaseCommandConfig = {
  command: string
  args: string[]
}

type StdioCommandConfig = BaseCommandConfig & {
  type: 'stdio'
}

export type AgentIntegrationId =
  | 'codex'
  | 'cursor'
  | 'claude'
  | 'gemini'
  | 'vscode'
  | 'opencode'
  | 'trae'
export type McpClientId = AgentIntegrationId

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

export type AgentIntegrationAction = {
  id:
    | 'plugin-prompt'
    | 'plugin-cli'
    | 'mcp-deep-link'
    | 'mcp-cli'
    | 'mcp-config'
    | 'skill-cli'
    | 'skill-design-to-code-cli'
    | 'skill-canvas-authoring-cli'
  label: string
  kind: 'deep-link' | McpClientCopyKind
  value: string
  fallbackValue?: string
}

export type AgentIntegrationConfig = {
  id: AgentIntegrationId
  name: string
  actions: AgentIntegrationAction[]
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

function buildCodexConfigSnippet(): string {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${JSON.stringify(SERVER_COMMAND)}`,
    `args = [${SERVER_ARGS.map((arg) => JSON.stringify(arg)).join(', ')}]`
  ].join('\n')
}

function buildMcpConfigSnippet(): string {
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

const OPENCODE_CONFIG_SNIPPET = JSON.stringify(
  {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      [SERVER_NAME]: {
        type: 'local',
        command: [SERVER_COMMAND, ...SERVER_ARGS]
      }
    }
  },
  null,
  2
)

function buildCliCommand(prefix: 'claude' | 'codex' | 'gemini' | 'vscode'): string {
  const args = `${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`
  if (prefix === 'claude') {
    return `claude mcp add --transport stdio "${SERVER_NAME}" -- ${args}`
  }

  if (prefix === 'gemini') {
    return `gemini mcp add --scope user "${SERVER_NAME}" ${args}`
  }

  if (prefix === 'vscode') {
    return `code --add-mcp '${JSON.stringify({
      name: SERVER_NAME,
      ...commandConfig
    })}'`
  }

  return `codex mcp add "${SERVER_NAME}" -- ${args}`
}

function buildPluginSetupCommand(prefix: 'claude' | 'codex'): string {
  if (prefix === 'claude') {
    return [
      `claude plugin marketplace add ${REPOSITORY}`,
      `claude plugin install ${PLUGIN_NAME}@${MARKETPLACE_NAME}`
    ].join(' && ')
  }

  return [
    `codex plugin marketplace add ${REPOSITORY} --ref main`,
    `codex plugin add ${PLUGIN_NAME}@${MARKETPLACE_NAME}`
  ].join(' && ')
}

function buildPluginSetupDeepLink(prefix: 'claude' | 'codex'): string {
  const command = buildPluginSetupCommand(prefix)
  const prompt = `Install the TemPad Dev agent plugin by running this command, then confirm that its MCP server plus figma-design-to-code and figma-canvas-authoring skills are available:\n\n${command}`
  const target = prefix === 'claude' ? 'claude-cli://open?q=' : 'codex://new?prompt='
  return `${target}${encodeURIComponent(prompt)}`
}

function buildSkillsInstallCommand(...agents: SkillAgentId[]): string {
  const targets = agents.map((agent) => `--agent ${agent}`).join(' ')
  return `${SKILLS_INSTALL_COMMAND} --global ${targets}`
}

function buildGeminiSkillInstallCommand(skillName: (typeof SKILL_NAMES)[number]): string {
  return `gemini skills install ${SKILLS_SOURCE_URL}/${skillName}`
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

export const MCP_SERVERS_CONFIG_SNIPPET = buildMcpConfigSnippet()

export const AGENT_SKILLS_INSTALL_COMMAND = SKILLS_INSTALL_COMMAND

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
    name: 'Codex',
    brandColor: ['#0d0d0d', '#fff'],
    supportsDeepLink: false,
    copyText: buildCliCommand('codex'),
    copyKind: 'command',
    alternateCopyText: buildCodexConfigSnippet(),
    alternateCopyKind: 'config'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    brandColor: '#4e6ef2',
    supportsDeepLink: false,
    copyText: buildCliCommand('gemini'),
    copyKind: 'command',
    alternateCopyText: buildMcpConfigSnippet(),
    alternateCopyKind: 'config'
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    brandColor: ['#211e1e', '#f1ecec'],
    supportsDeepLink: false,
    copyText: OPENCODE_CONFIG_SNIPPET,
    copyKind: 'config'
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
  MCP_CLIENTS_BY_ID.claude,
  MCP_CLIENTS_BY_ID.codex,
  MCP_CLIENTS_BY_ID.gemini,
  MCP_CLIENTS_BY_ID.opencode,
  MCP_CLIENTS_BY_ID.trae
]

export const AGENT_INTEGRATIONS_BY_ID: Record<AgentIntegrationId, AgentIntegrationConfig> = {
  codex: {
    id: 'codex',
    name: 'Codex',
    actions: [
      {
        id: 'plugin-prompt',
        label: 'Plugin install',
        kind: 'deep-link',
        value: buildPluginSetupDeepLink('codex')
      },
      {
        id: 'plugin-cli',
        label: 'Plugin CLI',
        kind: 'command',
        value: buildPluginSetupCommand('codex')
      }
    ]
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    actions: [
      {
        id: 'mcp-deep-link',
        label: 'MCP install',
        kind: 'deep-link',
        value: MCP_CLIENTS_BY_ID.cursor.deepLink ?? ''
      },
      {
        id: 'mcp-config',
        label: 'MCP config',
        kind: 'config',
        value: buildMcpConfigSnippet()
      },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: buildSkillsInstallCommand('cursor')
      }
    ]
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    actions: [
      {
        id: 'plugin-prompt',
        label: 'Plugin install',
        kind: 'deep-link',
        value: buildPluginSetupDeepLink('claude')
      },
      {
        id: 'plugin-cli',
        label: 'Plugin CLI',
        kind: 'command',
        value: buildPluginSetupCommand('claude')
      }
    ]
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    actions: [
      {
        id: 'mcp-cli',
        label: 'MCP CLI',
        kind: 'command',
        value: buildCliCommand('gemini')
      },
      {
        id: 'skill-design-to-code-cli',
        label: 'Design-to-code skill',
        kind: 'command',
        value: buildGeminiSkillInstallCommand(DESIGN_TO_CODE_SKILL_NAME)
      },
      {
        id: 'skill-canvas-authoring-cli',
        label: 'Canvas authoring skill',
        kind: 'command',
        value: buildGeminiSkillInstallCommand(CANVAS_AUTHORING_SKILL_NAME)
      }
    ]
  },
  vscode: {
    id: 'vscode',
    name: 'VS Code',
    actions: [
      {
        id: 'mcp-deep-link',
        label: 'MCP install',
        kind: 'deep-link',
        value: MCP_CLIENTS_BY_ID.vscode.deepLink ?? ''
      },
      {
        id: 'mcp-cli',
        label: 'MCP CLI',
        kind: 'command',
        value: buildCliCommand('vscode')
      },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: buildSkillsInstallCommand('github-copilot')
      }
    ]
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    actions: [
      {
        id: 'mcp-config',
        label: 'MCP config',
        kind: 'config',
        value: OPENCODE_CONFIG_SNIPPET
      },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: buildSkillsInstallCommand('opencode')
      }
    ]
  },
  trae: {
    id: 'trae',
    name: 'TRAE',
    actions: [
      {
        id: 'mcp-deep-link',
        label: 'MCP install',
        kind: 'deep-link',
        value: MCP_CLIENTS_BY_ID.trae.deepLink ?? '',
        fallbackValue: MCP_CLIENTS_BY_ID.trae.fallbackDeepLink
      },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: buildSkillsInstallCommand('trae')
      }
    ]
  }
}

export const AGENT_INTEGRATIONS: AgentIntegrationConfig[] = [
  AGENT_INTEGRATIONS_BY_ID.codex,
  AGENT_INTEGRATIONS_BY_ID.cursor,
  AGENT_INTEGRATIONS_BY_ID.claude,
  AGENT_INTEGRATIONS_BY_ID.gemini,
  AGENT_INTEGRATIONS_BY_ID.vscode,
  AGENT_INTEGRATIONS_BY_ID.opencode,
  AGENT_INTEGRATIONS_BY_ID.trae
]
