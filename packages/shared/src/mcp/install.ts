const SERVER_NAME = 'tempad-dev'
const SERVER_COMMAND = 'npx'
const SERVER_ARGS = ['-y', '@tempad-dev/mcp@latest'] as const
const REPOSITORY = 'ecomfe/tempad-dev'
const PLUGIN_INSTALL_COMMAND = `npx plugins add ${REPOSITORY}`

const SKILLS_SOURCE_URL =
  'https://github.com/ecomfe/tempad-dev/tree/main/agent-plugin/targets/standard/skills'
const DESIGN_TO_CODE_SKILL_NAME = 'figma-design-to-code'
const CANVAS_AUTHORING_SKILL_NAME = 'figma-canvas-authoring'
const SKILL_NAMES = [DESIGN_TO_CODE_SKILL_NAME, CANVAS_AUTHORING_SKILL_NAME] as const
const SKILLS_INSTALL_COMMAND = `npx skills add ${SKILLS_SOURCE_URL} --skill ${SKILL_NAMES.join(' ')}`

type AdditionalAgentId =
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'cline'
  | 'codebuddy'
  | 'github-copilot'
  | 'droid'
  | 'hermes-agent'
  | 'junie'
  | 'kilo'
  | 'kimi-code-cli'
  | 'kiro-cli'
  | 'pi'
  | 'qoder'
  | 'qwen-code'
  | 'zcode'
  | 'zed'
type SkillAgentId = 'opencode' | 'trae' | AdditionalAgentId
type PluginAgentId = 'claude-code' | 'codex' | 'cursor' | 'vscode'

type BaseCommandConfig = {
  command: string
  args: string[]
}

type StdioCommandConfig = BaseCommandConfig & {
  type: 'stdio'
}

export type AgentIntegrationId =
  | AdditionalAgentId
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
  /** Plain text with backtick-delimited inline code. */
  hint?: string
}

export type AgentIntegrationConfig = {
  id: AgentIntegrationId
  name: string
  actions: AgentIntegrationAction[]
  docsUrl?: string
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

function buildCliCommand(prefix: 'claude' | 'codex' | 'gemini'): string {
  const args = `${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`
  if (prefix === 'claude') {
    return `claude mcp add --transport stdio "${SERVER_NAME}" -- ${args}`
  }

  if (prefix === 'gemini') {
    return `gemini mcp add --scope user "${SERVER_NAME}" ${args}`
  }

  return `codex mcp add "${SERVER_NAME}" -- ${args}`
}

// This is a monorepo, so both native hosts check out only the marketplace manifest and the one
// target they install. The portable installer has no equivalent option.
const CODEX_SPARSE = '--sparse .agents --sparse agent-plugin/targets/codex'
const CLAUDE_SPARSE = '--sparse .claude-plugin agent-plugin/targets/claude'

function buildPluginSetupCommand(agent: PluginAgentId): string {
  if (agent === 'codex')
    return `codex plugin marketplace add ${REPOSITORY} --ref main ${CODEX_SPARSE} && codex plugin add tempad-dev@tempad-dev`
  if (agent === 'claude-code')
    return `claude plugin marketplace add ${REPOSITORY} ${CLAUDE_SPARSE} && claude plugin install tempad-dev@tempad-dev`
  return `${PLUGIN_INSTALL_COMMAND} --target ${agent}`
}

function pluginCliAction(agent: PluginAgentId): AgentIntegrationAction {
  return {
    id: 'plugin-cli',
    label: 'Plugin CLI',
    kind: 'command',
    value: buildPluginSetupCommand(agent)
  }
}

function buildSkillsInstallCommand(agent: SkillAgentId): string {
  return `${SKILLS_INSTALL_COMMAND} --global --agent ${agent}`
}

function buildGeminiSkillInstallCommand(skillName: (typeof SKILL_NAMES)[number]): string {
  return `gemini skills install https://github.com/${REPOSITORY}.git --path agent-plugin/targets/standard/skills/${skillName}`
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
export const AGENT_PLUGIN_INSTALL_COMMAND = PLUGIN_INSTALL_COMMAND

// Keep each host's config shape and destination next to its official reference. These are
// local MCP + skills setup paths, not declarations of native feedback/lifecycle support.
const additionalClients = {
  amp: {
    name: 'Amp',
    copyKind: 'command',
    copyText: `amp mcp add ${SERVER_NAME} -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`,
    docsUrl: 'https://ampcode.com/docs/customize/mcp'
  },
  antigravity: {
    name: 'Antigravity',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Open MCP Servers → Manage MCP Servers → View raw config, then merge this configuration:',
    docsUrl: 'https://antigravity.google/docs/mcp'
  },
  augment: {
    name: 'Augment Code',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Open Augment Settings → MCP → Import from JSON, paste this configuration, then save:',
    docsUrl: 'https://docs.augmentcode.com/setup-augment/mcp'
  },
  cline: {
    name: 'Cline',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Open MCP Servers → Configure → Configure MCP Servers, then merge this configuration. For Cline CLI, use `~/.cline/mcp.json`:',
    docsUrl: 'https://docs.cline.bot/mcp/mcp-overview'
  },
  codebuddy: {
    name: 'CodeBuddy',
    copyKind: 'config',
    copyText: JSON.stringify({ mcpServers: { [SERVER_NAME]: stdioConfig } }, null, 2),
    hint: 'For CodeBuddy Code, merge into `~/.codebuddy/.mcp.json` (user) or `.mcp.json` (project), then restart CodeBuddy:',
    docsUrl: 'https://www.codebuddy.ai/docs/cli/mcp'
  },
  'github-copilot': {
    name: 'Copilot CLI',
    copyKind: 'command',
    copyText: `copilot mcp add ${SERVER_NAME} -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`,
    docsUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers'
  },
  droid: {
    name: 'Droid',
    copyKind: 'command',
    copyText: `droid mcp add ${SERVER_NAME} "${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}" --type stdio`,
    docsUrl: 'https://docs.factory.ai/cli/configuration/mcp'
  },
  'hermes-agent': {
    name: 'Hermes Agent',
    copyKind: 'config',
    copyText: `mcp_servers:\n  ${SERVER_NAME}:\n    command: ${SERVER_COMMAND}\n    args: ${JSON.stringify(SERVER_ARGS)}`,
    hint: 'Merge into `~/.hermes/config.yaml`, then restart Hermes. Standard Hermes installations include MCP support:',
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/'
  },
  junie: {
    name: 'Junie',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Merge into `~/.junie/mcp/mcp.json` (user) or `.junie/mcp/mcp.json` (project). Junie CLI and JetBrains IDEs share this format:',
    docsUrl: 'https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html'
  },
  kilo: {
    name: 'Kilo Code',
    copyKind: 'config',
    copyText: JSON.stringify(
      { mcp: { [SERVER_NAME]: { type: 'local', command: [SERVER_COMMAND, ...SERVER_ARGS] } } },
      null,
      2
    ),
    hint: 'For Kilo CLI, merge into `~/.config/kilo/kilo.json` (global) or `.kilo/kilo.json` (project):',
    docsUrl: 'https://kilo.ai/docs/automate/mcp/using-in-cli'
  },
  'kimi-code-cli': {
    name: 'Kimi Code',
    copyKind: 'command',
    copyText: `kimi mcp add --transport stdio ${SERVER_NAME} -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`,
    docsUrl: 'https://moonshotai.github.io/kimi-cli/en/customization/mcp.html'
  },
  'kiro-cli': {
    name: 'Kiro CLI',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Merge into `~/.kiro/settings/mcp.json`. The default agent loads installed skills automatically; custom agents must include them in their `resources`:',
    docsUrl: 'https://kiro.dev/docs/mcp/configuration/'
  },
  pi: {
    name: 'Pi',
    copyKind: 'command',
    copyText: `pi mcp add ${SERVER_NAME} -- ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`,
    hint: 'Requires Pi 0.99 or later with built-in MCP enabled. Run in your terminal, then use `/reload` in an existing Pi session:',
    docsUrl: 'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/mcp.md'
  },
  qoder: {
    name: 'Qoder',
    copyKind: 'config',
    copyText: MCP_SERVERS_CONFIG_SNIPPET,
    hint: 'Open Qoder Settings → MCP → My Servers → Add, then paste this configuration:',
    docsUrl: 'https://docs.qoder.com/user-guide/chat/model-context-protocol'
  },
  'qwen-code': {
    name: 'Qwen Code',
    copyKind: 'command',
    copyText: `qwen mcp add --scope user ${SERVER_NAME} ${SERVER_COMMAND} ${SERVER_ARGS.join(' ')}`,
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/'
  },
  zcode: {
    name: 'ZCode',
    copyKind: 'config',
    copyText: JSON.stringify({ mcp: { servers: { [SERVER_NAME]: commandConfig } } }, null, 2),
    hint: 'Merge into `~/.zcode/cli/config.json` (user) or `.zcode/config.json` (workspace):',
    docsUrl: 'https://zcode.z.ai/cn/docs/mcp-services'
  },
  zed: {
    name: 'Zed',
    copyKind: 'config',
    copyText: JSON.stringify({ context_servers: { [SERVER_NAME]: commandConfig } }, null, 2),
    hint: 'Merge into Zed user `settings.json`. Use Zed’s built-in agent to access these MCP tools:',
    docsUrl: 'https://zed.dev/docs/ai/mcp'
  }
} satisfies Record<
  AdditionalAgentId,
  {
    name: string
    copyKind: McpClientCopyKind
    copyText: string
    hint?: string
    docsUrl: string
  }
>

function additionalMcpClient(id: AdditionalAgentId): McpClientConfig {
  const { name, copyKind, copyText } = additionalClients[id]
  return { id, name, copyKind, copyText, supportsDeepLink: false }
}

function additionalIntegration(id: AdditionalAgentId): AgentIntegrationConfig {
  const client = additionalClients[id]
  return {
    id,
    name: client.name,
    docsUrl: client.docsUrl,
    actions: [
      {
        id: client.copyKind === 'config' ? 'mcp-config' : 'mcp-cli',
        label: client.copyKind === 'config' ? 'MCP config' : 'MCP CLI',
        kind: client.copyKind,
        value: client.copyText,
        ...('hint' in client ? { hint: client.hint } : {})
      },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: buildSkillsInstallCommand(id)
      }
    ]
  }
}

export const MCP_CLIENTS_BY_ID: Record<McpClientId, McpClientConfig> = {
  amp: additionalMcpClient('amp'),
  antigravity: additionalMcpClient('antigravity'),
  augment: additionalMcpClient('augment'),
  cline: additionalMcpClient('cline'),
  codebuddy: additionalMcpClient('codebuddy'),
  'github-copilot': additionalMcpClient('github-copilot'),
  droid: additionalMcpClient('droid'),
  'hermes-agent': additionalMcpClient('hermes-agent'),
  junie: additionalMcpClient('junie'),
  kilo: additionalMcpClient('kilo'),
  'kimi-code-cli': additionalMcpClient('kimi-code-cli'),
  'kiro-cli': additionalMcpClient('kiro-cli'),
  pi: additionalMcpClient('pi'),
  qoder: additionalMcpClient('qoder'),
  'qwen-code': additionalMcpClient('qwen-code'),
  zcode: additionalMcpClient('zcode'),
  zed: additionalMcpClient('zed'),
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

export const MCP_CLIENTS: McpClientConfig[] = Object.values(MCP_CLIENTS_BY_ID)

export const AGENT_INTEGRATIONS_BY_ID: Record<AgentIntegrationId, AgentIntegrationConfig> = {
  codex: {
    id: 'codex',
    name: 'Codex',
    docsUrl: 'https://developers.openai.com/plugins/build/plugins',
    actions: [pluginCliAction('codex')]
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    docsUrl: 'https://code.claude.com/docs/en/discover-plugins',
    actions: [pluginCliAction('claude-code')]
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    docsUrl: 'https://cursor.com/docs/plugins',
    actions: [pluginCliAction('cursor')]
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    docsUrl: 'https://geminicli.com/docs/cli/cli-reference/',
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
    docsUrl: 'https://code.visualstudio.com/docs/agent-customization/agent-plugins',
    actions: [pluginCliAction('vscode')]
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    docsUrl: 'https://opencode.ai/docs/mcp-servers/',
    actions: [
      {
        id: 'mcp-config',
        label: 'MCP config',
        kind: 'config',
        value: OPENCODE_CONFIG_SNIPPET,
        hint: 'Merge into `~/.config/opencode/opencode.json` (global) or `opencode.json` (project):'
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
    docsUrl: 'https://docs.trae.ai/ide/mcp-server-install-links',
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
        value: buildSkillsInstallCommand('trae'),
        hint: 'Run in your terminal. For TRAE China, replace `--agent trae` with `--agent trae-cn`:'
      }
    ]
  },
  amp: additionalIntegration('amp'),
  antigravity: additionalIntegration('antigravity'),
  augment: additionalIntegration('augment'),
  cline: additionalIntegration('cline'),
  codebuddy: additionalIntegration('codebuddy'),
  'github-copilot': additionalIntegration('github-copilot'),
  droid: additionalIntegration('droid'),
  'hermes-agent': additionalIntegration('hermes-agent'),
  junie: additionalIntegration('junie'),
  kilo: additionalIntegration('kilo'),
  'kimi-code-cli': additionalIntegration('kimi-code-cli'),
  'kiro-cli': additionalIntegration('kiro-cli'),
  pi: additionalIntegration('pi'),
  qoder: additionalIntegration('qoder'),
  'qwen-code': additionalIntegration('qwen-code'),
  zcode: additionalIntegration('zcode'),
  zed: additionalIntegration('zed')
}

export const AGENT_INTEGRATIONS: AgentIntegrationConfig[] = Object.values(AGENT_INTEGRATIONS_BY_ID)
