import { afterEach, describe, expect, it, vi } from 'vitest'

const originalBtoa = globalThis.btoa
const SKILLS_SOURCE_URL =
  'https://github.com/ecomfe/tempad-dev/tree/main/agent-plugin/targets/standard/skills'
const SKILLS_INSTALL_COMMAND = `npx skills add ${SKILLS_SOURCE_URL} --skill figma-design-to-code figma-canvas-authoring`
const PLUGIN_INSTALL_COMMAND = 'npx plugins add ecomfe/tempad-dev'
const ADDITIONAL_AGENTS = [
  'amp',
  'antigravity',
  'augment',
  'cline',
  'codebuddy',
  'continue',
  'goose',
  'grok',
  'mistral-vibe',
  'warp',
  'github-copilot',
  'droid',
  'hermes-agent',
  'junie',
  'kilo',
  'kimi-code-cli',
  'kiro-cli',
  'pi',
  'qoder',
  'qwen-code',
  'zcode',
  'zed'
] as const

function restoreBtoa() {
  if (originalBtoa) {
    globalThis.btoa = originalBtoa
    return
  }

  Reflect.deleteProperty(globalThis, 'btoa')
}

async function importInstall() {
  vi.resetModules()
  return import('../../src/mcp/install')
}

afterEach(() => {
  restoreBtoa()
})

describe('shared/mcp/install', () => {
  it('builds stable MCP server metadata for editors and CLIs', async () => {
    globalThis.btoa = (input: string) => Buffer.from(input, 'utf8').toString('base64')
    const mcp = await importInstall()

    expect(mcp.MCP_SERVER).toEqual({
      name: 'tempad-dev',
      command: 'npx',
      args: ['-y', '@tempad-dev/mcp@latest']
    })

    expect(mcp.MCP_DEFAULT_CONFIG_SNIPPET).toContain('"tempad-dev"')
    expect(JSON.parse(mcp.MCP_SERVERS_CONFIG_SNIPPET)).toEqual({
      mcpServers: {
        'tempad-dev': {
          command: 'npx',
          args: ['-y', '@tempad-dev/mcp@latest']
        }
      }
    })
    expect(mcp.AGENT_SKILLS_INSTALL_COMMAND).toBe(SKILLS_INSTALL_COMMAND)
    expect(mcp.AGENT_PLUGIN_INSTALL_COMMAND).toBe(PLUGIN_INSTALL_COMMAND)

    const vscodeDeepLink = mcp.MCP_CLIENTS_BY_ID.vscode.deepLink
    expect(vscodeDeepLink).toMatch(/^vscode:mcp\/install\?/)
    const vscodePayload = decodeURIComponent(
      String(vscodeDeepLink).replace('vscode:mcp/install?', '')
    )
    expect(JSON.parse(vscodePayload)).toEqual({
      name: 'tempad-dev',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@tempad-dev/mcp@latest']
    })

    const cursorDeepLink = mcp.MCP_CLIENTS_BY_ID.cursor.deepLink
    expect(cursorDeepLink).toContain(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=tempad-dev'
    )
    const cursorUrl = new URL(String(cursorDeepLink))
    const encodedCursorConfig = cursorUrl.searchParams.get('config')
    expect(encodedCursorConfig).toBeTruthy()
    const decodedCursorConfigJson = Buffer.from(
      decodeURIComponent(String(encodedCursorConfig)),
      'base64'
    ).toString('utf8')
    expect(JSON.parse(decodedCursorConfigJson)).toEqual({
      command: 'npx',
      args: ['-y', '@tempad-dev/mcp@latest']
    })

    expect(mcp.MCP_CLIENTS_BY_ID.trae.deepLink).toContain('trae://trae.ai-ide/mcp-import')
    expect(mcp.MCP_CLIENTS_BY_ID.trae.fallbackDeepLink).toContain(
      'trae-cn://trae.ai-ide/mcp-import'
    )
    expect(mcp.MCP_CLIENTS_BY_ID.cursor.brandColor).toEqual(['#000', '#fff'])

    expect(mcp.MCP_CLIENTS_BY_ID.claude.copyText).toContain('claude mcp add --transport stdio')
    expect(mcp.MCP_CLIENTS_BY_ID.codex.copyKind).toBe('command')
    expect(mcp.MCP_CLIENTS_BY_ID.codex.copyText).toContain('codex mcp add "tempad-dev"')
    expect(mcp.MCP_CLIENTS_BY_ID.codex.alternateCopyKind).toBe('config')
    expect(mcp.MCP_CLIENTS_BY_ID.codex.alternateCopyText).toBe(
      '[mcp_servers.tempad-dev]\ncommand = "npx"\nargs = ["-y", "@tempad-dev/mcp@latest"]'
    )
    expect(mcp.MCP_CLIENTS_BY_ID.gemini.copyText).toBe(
      'gemini mcp add --scope user "tempad-dev" npx -y @tempad-dev/mcp@latest'
    )
    expect(JSON.parse(mcp.MCP_CLIENTS_BY_ID.opencode.copyText ?? '')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        'tempad-dev': {
          type: 'local',
          command: ['npx', '-y', '@tempad-dev/mcp@latest']
        }
      }
    })
    expect(mcp.MCP_CLIENTS).toHaveLength(30)
  })

  it('describes the supported plugin and MCP setup paths', async () => {
    globalThis.btoa = (input: string) => Buffer.from(input, 'utf8').toString('base64')
    const mcp = await importInstall()

    expect(mcp.AGENT_INTEGRATIONS.map(({ id }) => id)).toEqual([
      'codex',
      'claude',
      'cursor',
      'vscode',
      'amp',
      'antigravity',
      'augment',
      'cline',
      'codebuddy',
      'continue',
      'github-copilot',
      'deepseek',
      'droid',
      'gemini',
      'goose',
      'grok',
      'hermes-agent',
      'junie',
      'kilo',
      'kimi-code-cli',
      'kiro-cli',
      'mistral-vibe',
      'opencode',
      'pi',
      'qoder',
      'qwen-code',
      'trae',
      'warp',
      'zcode',
      'zed'
    ])

    const codex = mcp.AGENT_INTEGRATIONS_BY_ID.codex
    expect(codex.actions).toEqual([
      expect.objectContaining({
        id: 'plugin-cli',
        label: 'Plugin CLI',
        kind: 'command',
        value:
          'codex plugin marketplace add ecomfe/tempad-dev --ref main --sparse .agents --sparse agent-plugin/targets/codex && codex plugin add tempad-dev@tempad-dev'
      })
    ])
    const claude = mcp.AGENT_INTEGRATIONS_BY_ID.claude
    expect(claude.actions).toEqual([
      expect.objectContaining({
        id: 'plugin-cli',
        kind: 'command',
        value:
          'claude plugin marketplace add ecomfe/tempad-dev --sparse .claude-plugin agent-plugin/targets/claude && claude plugin install tempad-dev@tempad-dev'
      })
    ])
    expect(
      mcp.AGENT_INTEGRATIONS.flatMap(({ actions }) => actions).filter(
        ({ kind }) => kind === 'deep-link'
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: expect.stringMatching(/^\w+:\/\//) })
      ])
    )
    expect(
      mcp.AGENT_INTEGRATIONS.flatMap(({ actions }) => actions).some(({ value }) =>
        value.startsWith('claude-cli://')
      )
    ).toBe(false)

    const cursor = mcp.AGENT_INTEGRATIONS_BY_ID.cursor
    expect(cursor.actions).toEqual([
      expect.objectContaining({
        id: 'plugin-cli',
        kind: 'command',
        value: `${PLUGIN_INSTALL_COMMAND} --target cursor`
      })
    ])

    const gemini = mcp.AGENT_INTEGRATIONS_BY_ID.gemini
    expect(gemini.actions.map(({ id }) => id)).toEqual([
      'mcp-cli',
      'skill-design-to-code-cli',
      'skill-canvas-authoring-cli'
    ])
    expect(gemini.actions[0]?.value).toContain('gemini mcp add --scope user')
    expect(gemini.actions[1]?.value).toBe(
      'gemini skills install https://github.com/ecomfe/tempad-dev.git --path agent-plugin/targets/standard/skills/figma-design-to-code'
    )
    expect(gemini.actions[2]?.value).toBe(
      'gemini skills install https://github.com/ecomfe/tempad-dev.git --path agent-plugin/targets/standard/skills/figma-canvas-authoring'
    )

    const vscode = mcp.AGENT_INTEGRATIONS_BY_ID.vscode
    expect(vscode.actions).toEqual([
      expect.objectContaining({
        id: 'plugin-cli',
        kind: 'command',
        value: `${PLUGIN_INSTALL_COMMAND} --target vscode`
      })
    ])

    const opencode = mcp.AGENT_INTEGRATIONS_BY_ID.opencode
    expect(opencode.actions.map(({ id }) => id)).toEqual(['mcp-config', 'skill-cli'])
    expect(opencode.actions[0]?.value).toBe(mcp.MCP_CLIENTS_BY_ID.opencode.copyText)
    expect(opencode.actions[1]?.value).toContain('--global --agent opencode')

    expect(mcp.AGENT_INTEGRATIONS_BY_ID.trae.actions[0]).toEqual(
      expect.objectContaining({
        id: 'mcp-deep-link',
        kind: 'deep-link',
        value: expect.stringMatching(/^trae:\/\//),
        fallbackValue: expect.stringMatching(/^trae-cn:\/\//)
      })
    )
    for (const [id, agent] of [
      ['opencode', 'opencode'],
      ['trae', 'trae']
    ] as const) {
      const skillAction = mcp.AGENT_INTEGRATIONS_BY_ID[id].actions.find(
        ({ id: actionId }) => actionId === 'skill-cli'
      )
      expect(skillAction?.value).toBe(`${SKILLS_INSTALL_COMMAND} --global --agent ${agent}`)
    }
  })

  it('provides targeted skills and documented setup instructions for additional agents', async () => {
    const mcp = await importInstall()
    for (const id of ADDITIONAL_AGENTS) {
      const integration = mcp.AGENT_INTEGRATIONS_BY_ID[id]
      const client = mcp.MCP_CLIENTS_BY_ID[id]
      expect(integration.name).toBe(client.name)
      expect(integration.docsUrl).toMatch(/^https:\/\//)
      expect(integration.actions.map(({ id }) => id)).toEqual([
        client.copyKind === 'command' ? 'mcp-cli' : 'mcp-config',
        'skill-cli'
      ])
      expect(integration.actions[0]?.value).toBe(client.copyText)
      expect(integration.actions[0]?.value).toContain('@tempad-dev/mcp@latest')
      if (client.copyKind === 'config') expect(integration.actions[0]?.hint).toBeTruthy()
      expect(integration.actions[1]?.value).toBe(`${SKILLS_INSTALL_COMMAND} --global --agent ${id}`)
    }
  })

  it('uses a Cordis patch and project-scoped universal skills for DeepSeek Harness', async () => {
    const { MCP_CLIENTS_BY_ID: clients, AGENT_INTEGRATIONS_BY_ID: integrations } =
      await importInstall()
    const [mcp, skills] = integrations.deepseek.actions
    expect(mcp?.value).toBe(
      [
        '- insert:',
        '    - id: mcp-tempad-dev',
        "      name: '@deepseek-ai/dsh-mcp-client'",
        '      config:',
        '        serverName: tempad-dev',
        '        transport: stdio',
        '        command: npx',
        '        args: ["-y","@tempad-dev/mcp@latest"]'
      ].join('\n')
    )
    expect(clients.deepseek.copyKind).toBe('config')
    expect(clients.deepseek.copyText).toBe(mcp?.value)
    expect(mcp?.hint).toContain('`~/.dsh/cordis.patch.yml`')
    expect(skills?.value).toBe(`${SKILLS_INSTALL_COMMAND} --agent universal`)
    expect(skills?.hint).toContain('`.agents/skills`')
  })

  it('uses the native CLI syntax for each harness', async () => {
    const { MCP_CLIENTS_BY_ID: clients, AGENT_INTEGRATIONS_BY_ID: integrations } =
      await importInstall()
    expect(clients.amp.copyText).toBe('amp mcp add tempad-dev -- npx -y @tempad-dev/mcp@latest')
    expect(clients.grok.copyText).toBe('grok mcp add tempad-dev -- npx -y @tempad-dev/mcp@latest')
    expect(clients['github-copilot'].copyText).toBe(
      'copilot mcp add tempad-dev -- npx -y @tempad-dev/mcp@latest'
    )
    expect(clients.droid.copyText).toBe(
      'droid mcp add tempad-dev "npx -y @tempad-dev/mcp@latest" --type stdio'
    )
    expect(clients['kimi-code-cli'].copyText).toBe(
      'kimi mcp add --transport stdio tempad-dev -- npx -y @tempad-dev/mcp@latest'
    )
    expect(clients['qwen-code'].copyText).toBe(
      'qwen mcp add --scope user tempad-dev npx -y @tempad-dev/mcp@latest'
    )
    expect(clients.pi.copyText).toBe('pi mcp add tempad-dev -- npx -y @tempad-dev/mcp@latest')
    expect(integrations.pi.actions[0]?.hint).toContain('Pi 0.99')
  })

  it('keeps host-specific configuration formats instead of assuming mcpServers everywhere', async () => {
    const { MCP_CLIENTS_BY_ID: clients } = await importInstall()
    const command = { command: 'npx', args: ['-y', '@tempad-dev/mcp@latest'] }
    for (const id of ['antigravity', 'augment', 'cline', 'junie', 'kiro-cli', 'qoder'] as const) {
      expect(JSON.parse(clients[id].copyText!)).toEqual({ mcpServers: { 'tempad-dev': command } })
    }
    expect(JSON.parse(clients.kilo.copyText!)).toEqual({
      mcp: { 'tempad-dev': { type: 'local', command: ['npx', '-y', '@tempad-dev/mcp@latest'] } }
    })
    expect(JSON.parse(clients.codebuddy.copyText!)).toEqual({
      mcpServers: { 'tempad-dev': { type: 'stdio', ...command } }
    })
    expect(JSON.parse(clients.zed.copyText!)).toEqual({
      context_servers: { 'tempad-dev': command }
    })
    expect(JSON.parse(clients.zcode.copyText!)).toEqual({
      mcp: { servers: { 'tempad-dev': command } }
    })
    expect(clients['hermes-agent'].copyText).toBe(
      'mcp_servers:\n  tempad-dev:\n    command: npx\n    args: ["-y","@tempad-dev/mcp@latest"]'
    )
  })

  it('falls back to Buffer when btoa is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'btoa')

    const mcp = await importInstall()
    expect(mcp.MCP_CLIENTS_BY_ID.cursor.deepLink).toContain('config=')
  })
})
