import { afterEach, describe, expect, it, vi } from 'vitest'

const originalBtoa = globalThis.btoa
const SKILLS_SOURCE_URL =
  'https://github.com/ecomfe/tempad-dev/tree/main/agent-plugins/tempad-dev/skills'
const DESIGN_TO_CODE_SKILL_URL = `${SKILLS_SOURCE_URL}/figma-design-to-code`
const CANVAS_AUTHORING_SKILL_URL = `${SKILLS_SOURCE_URL}/figma-canvas-authoring`
const SKILLS_INSTALL_COMMAND = `npx skills add ${SKILLS_SOURCE_URL} --skill figma-design-to-code figma-canvas-authoring`
const PLUGIN_INSTALL_COMMAND = 'npx plugins add ecomfe/tempad-dev'

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
    expect(mcp.MCP_CLIENTS).toHaveLength(7)
  })

  it('describes the supported app and CLI setup paths', async () => {
    globalThis.btoa = (input: string) => Buffer.from(input, 'utf8').toString('base64')
    const mcp = await importInstall()

    expect(mcp.AGENT_INTEGRATIONS.map(({ id }) => id)).toEqual([
      'codex',
      'cursor',
      'claude',
      'gemini',
      'vscode',
      'opencode',
      'trae'
    ])

    const codex = mcp.AGENT_INTEGRATIONS_BY_ID.codex
    expect(codex.actions).toEqual([
      expect.objectContaining({
        id: 'plugin-prompt',
        label: 'Plugin install',
        kind: 'deep-link',
        value: expect.stringMatching(/^codex:\/\/new\?prompt=/)
      }),
      expect.objectContaining({
        id: 'plugin-cli',
        label: 'Plugin CLI',
        kind: 'command',
        value: `${PLUGIN_INSTALL_COMMAND} --target codex`
      })
    ])
    const codexPluginPrompt = decodeURIComponent(codex.actions[0]?.value ?? '')
    expect(codexPluginPrompt).toContain(`${PLUGIN_INSTALL_COMMAND} --target codex`)
    expect(codexPluginPrompt).toContain('figma-design-to-code')
    expect(codexPluginPrompt).toContain('figma-canvas-authoring')

    const claude = mcp.AGENT_INTEGRATIONS_BY_ID.claude
    expect(claude.actions[0]?.value).toMatch(/^claude-cli:\/\/open\?q=/)
    const claudePluginPrompt = decodeURIComponent(claude.actions[0]?.value ?? '')
    expect(claudePluginPrompt).toContain(`${PLUGIN_INSTALL_COMMAND} --target claude-code`)
    expect(claudePluginPrompt).toContain('figma-canvas-authoring')

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
    expect(gemini.actions[1]?.value).toBe(`gemini skills install ${DESIGN_TO_CODE_SKILL_URL}`)
    expect(gemini.actions[2]?.value).toBe(`gemini skills install ${CANVAS_AUTHORING_SKILL_URL}`)

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

  it('falls back to Buffer when btoa is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'btoa')

    const mcp = await importInstall()
    expect(mcp.MCP_CLIENTS_BY_ID.cursor.deepLink).toContain('config=')
  })
})
