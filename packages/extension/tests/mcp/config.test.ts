import { afterEach, describe, expect, it, vi } from 'vitest'

const originalBtoa = globalThis.btoa

function restoreBtoa() {
  if (originalBtoa) {
    globalThis.btoa = originalBtoa
    return
  }
  Reflect.deleteProperty(globalThis, 'btoa')
}

async function importConfig() {
  vi.resetModules()
  return import('../../mcp/config')
}

afterEach(() => {
  restoreBtoa()
})

describe('mcp/config', () => {
  it('builds stable MCP server and client install metadata', async () => {
    globalThis.btoa = (input: string) => Buffer.from(input, 'utf8').toString('base64')
    const tempad = await importConfig()

    expect(tempad.MCP_SERVER).toEqual({
      name: 'tempad-dev',
      command: 'npx',
      args: ['-y', '@tempad-dev/mcp@latest']
    })

    const vscodeDeepLink = tempad.MCP_CLIENTS_BY_ID.vscode.deepLink
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

    const cursorDeepLink = tempad.MCP_CLIENTS_BY_ID.cursor.deepLink
    expect(cursorDeepLink).toContain(
      'cursor://anysphere.cursor-deeplink/mcp/install?name=tempad-dev'
    )
    expect(cursorDeepLink).toContain('config=')

    expect(tempad.MCP_CLIENTS_BY_ID.trae.deepLink).toContain('trae://trae.ai-ide/mcp-import')
    expect(tempad.MCP_CLIENTS_BY_ID.trae.fallbackDeepLink).toContain(
      'trae-cn://trae.ai-ide/mcp-import'
    )

    expect(tempad.MCP_CLIENTS_BY_ID.windsurf.copyKind).toBe('config')
    expect(JSON.parse(String(tempad.MCP_CLIENTS_BY_ID.windsurf.copyText))).toEqual({
      mcpServers: {
        'tempad-dev': {
          command: 'npx',
          args: ['-y', '@tempad-dev/mcp@latest']
        }
      }
    })

    expect(tempad.MCP_CLIENTS_BY_ID.claude.copyKind).toBe('command')
    expect(tempad.MCP_CLIENTS_BY_ID.claude.copyText).toContain('claude mcp add --transport stdio')
    expect(tempad.MCP_CLIENTS_BY_ID.codex.copyText).toContain('codex mcp add "tempad-dev"')

    expect(tempad.MCP_CLIENTS).toEqual([
      tempad.MCP_CLIENTS_BY_ID.vscode,
      tempad.MCP_CLIENTS_BY_ID.cursor,
      tempad.MCP_CLIENTS_BY_ID.windsurf,
      tempad.MCP_CLIENTS_BY_ID.claude,
      tempad.MCP_CLIENTS_BY_ID.codex,
      tempad.MCP_CLIENTS_BY_ID.trae
    ])
  })

  it('throws when base64 encoding is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'btoa')

    await expect(importConfig()).rejects.toThrow(
      'Base64 encoding not supported in this environment.'
    )
  })
})
