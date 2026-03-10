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
    expect(mcp.MCP_SKILL_INSTALL_COMMAND).toContain('npx skills add')

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

    expect(mcp.MCP_CLIENTS_BY_ID.windsurf.copyKind).toBe('config')
    expect(JSON.parse(String(mcp.MCP_CLIENTS_BY_ID.windsurf.copyText))).toEqual({
      mcpServers: {
        'tempad-dev': {
          command: 'npx',
          args: ['-y', '@tempad-dev/mcp@latest']
        }
      }
    })

    expect(mcp.MCP_CLIENTS_BY_ID.claude.copyText).toContain('claude mcp add --transport stdio')
    expect(mcp.MCP_CLIENTS_BY_ID.codex.copyText).toContain('codex mcp add "tempad-dev"')
    expect(mcp.MCP_CLIENTS).toHaveLength(6)
  })

  it('falls back to Buffer when btoa is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'btoa')

    const mcp = await importInstall()
    expect(mcp.MCP_CLIENTS_BY_ID.cursor.deepLink).toContain('config=')
  })
})
