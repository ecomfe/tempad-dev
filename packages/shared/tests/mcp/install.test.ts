import { afterEach, describe, expect, it, vi } from 'vitest'

const originalBtoa = globalThis.btoa

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
    expect(mcp.AGENT_SKILL_INSTALL_COMMAND).toContain('npx skills add')

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
    expect(mcp.MCP_CLIENTS).toHaveLength(6)
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
        value: expect.stringContaining('codex plugin marketplace add ecomfe/tempad-dev')
      })
    ])
    expect(decodeURIComponent(codex.actions[0]?.value ?? '')).toContain(
      'codex plugin add tempad-dev@tempad-dev'
    )

    const claude = mcp.AGENT_INTEGRATIONS_BY_ID.claude
    expect(claude.actions[0]?.value).toMatch(/^claude-cli:\/\/open\?q=/)
    expect(decodeURIComponent(claude.actions[0]?.value ?? '')).toContain(
      'claude plugin install tempad-dev@tempad-dev'
    )

    const cursor = mcp.AGENT_INTEGRATIONS_BY_ID.cursor
    expect(JSON.parse(cursor.actions[1]?.value ?? '')).toHaveProperty(
      'mcpServers.tempad-dev.command',
      'npx'
    )
    expect(cursor.actions.map(({ id }) => id)).toEqual(['mcp-deep-link', 'mcp-config', 'skill-cli'])

    const gemini = mcp.AGENT_INTEGRATIONS_BY_ID.gemini
    expect(gemini.actions.map(({ id }) => id)).toEqual(['mcp-cli', 'mcp-config', 'skill-cli'])
    expect(gemini.actions[0]?.value).toContain('gemini mcp add --scope user')

    const vscode = mcp.AGENT_INTEGRATIONS_BY_ID.vscode
    expect(vscode.actions.map(({ id }) => id)).toEqual(['mcp-deep-link', 'mcp-cli', 'skill-cli'])
    expect(vscode.actions[1]?.value).toContain('code --add-mcp')
    expect(mcp.AGENT_INTEGRATIONS_BY_ID.trae.actions[0]).toEqual(
      expect.objectContaining({
        id: 'mcp-deep-link',
        kind: 'deep-link',
        value: expect.stringMatching(/^trae:\/\//),
        fallbackValue: expect.stringMatching(/^trae-cn:\/\//)
      })
    )
    expect(mcp.AGENT_INTEGRATIONS_BY_ID.trae.actions[1]?.id).toBe('skill-cli')
  })

  it('falls back to Buffer when btoa is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'btoa')

    const mcp = await importInstall()
    expect(mcp.MCP_CLIENTS_BY_ID.cursor.deepLink).toContain('config=')
  })
})
