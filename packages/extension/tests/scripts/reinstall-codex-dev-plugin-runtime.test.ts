import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertCdpOwner,
  assertNoRestartJob,
  cdpWebSocketUrl,
  checkoutRuntimeProcesses,
  devPluginId,
  inspectDevPlugin,
  localCdpPort,
  matchingProcesses,
  parseReinstallArguments,
  resolveDevPluginVersion,
  selectCodexPageUrl
} from '@/scripts/reinstall-codex-dev-plugin-runtime'

const pluginRoot = '/checkout/.dev/plugins/tempad-dev-dev'
const version = '0.2.0+codex.new'
const entry = {
  pluginId: devPluginId,
  name: 'tempad-dev-dev',
  marketplaceName: 'tempad-dev-dev',
  installed: true,
  enabled: true,
  version,
  source: { source: 'local', path: pluginRoot },
  marketplaceSource: { sourceType: 'local', source: '/checkout/.dev' }
}

function runner(installed: unknown[] = [entry], available: unknown[] = []) {
  return vi.fn<(args: string[]) => Promise<unknown>>().mockResolvedValue({ installed, available })
}

afterEach(() => vi.unstubAllEnvs())

describe('Codex App reinstall arguments', () => {
  it('defaults to the generated version and rejects a requested mismatch', () => {
    const manifest = { name: 'tempad-dev-dev', version }
    expect(resolveDevPluginVersion(manifest)).toBe(version)
    expect(resolveDevPluginVersion(manifest, version)).toBe(version)
    expect(() => resolveDevPluginVersion(manifest, 'old')).toThrow('not old')
    expect(() => resolveDevPluginVersion(null)).toThrow('must be an object')
    expect(() => resolveDevPluginVersion({ name: 'another', version })).toThrow(
      'unexpected identity'
    )
  })

  it('requires an explicit restart flag and permits precise App and page selection', () => {
    vi.stubEnv('CODEX_CDP_URL', 'http://localhost:9444')
    expect(parseReinstallArguments([])).toEqual({
      cdpPort: 9444,
      cdpUrl: 'http://localhost:9444',
      restartCodex: false,
      resumeAfterRestart: false,
      timeoutMs: 60000
    })
    expect(
      parseReinstallArguments([
        version,
        '--app-path',
        '/Apps/Codex.app',
        '--timeout-ms',
        '2500',
        '--cdp-url',
        'http://127.0.0.1:9222',
        '--page-url',
        'window=main',
        '--restart-codex'
      ])
    ).toMatchObject({
      version,
      appPath: '/Apps/Codex.app',
      timeoutMs: 2500,
      cdpUrl: 'http://127.0.0.1:9222',
      pageUrl: 'window=main',
      restartCodex: true
    })
    expect(parseReinstallArguments(['--help'])).toBeNull()
  })

  it.each([
    ['--timeout-ms', '0'],
    ['--timeout-ms', 'NaN'],
    ['--timeout-ms', '1.5'],
    ['--app-path'],
    ['--cdp-url'],
    ['--unknown'],
    ['one', 'two'],
    ['--cdp-url', 'http://evil.test:9222']
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseReinstallArguments(args)).toThrow()
  })

  it('refuses a non-loopback endpoint supplied through the environment', () => {
    vi.stubEnv('CODEX_CDP_URL', 'http://evil.test:9222')
    expect(() => parseReinstallArguments([])).toThrow('loopback')
  })

  it.each([
    'https://localhost:9222',
    'http://example.com:9222',
    'http://localhost@evil.test:9222',
    'http://user@localhost:9222',
    'http://localhost:9222/other',
    'http://localhost:9222/?x=1'
  ])('refuses a non-loopback origin or ambiguous CDP URL %s', (url) => {
    expect(() => localCdpPort(url)).toThrow()
  })

  it('accepts local IPv4 and IPv6 origins', () => {
    expect(localCdpPort('http://127.0.0.1:9222')).toBe(9222)
    expect(localCdpPort('http://[::1]:9333')).toBe(9333)
  })
})

describe('read-only plugin source and installation verification', () => {
  it('reads the configured source without using CLI add as an App refresh', async () => {
    const run = runner([{ ...entry, version: 'old' }])
    await inspectDevPlugin(run, pluginRoot)
    expect(run.mock.calls).toEqual([
      [['plugin', 'list', '--available', '--json', '--marketplace', 'tempad-dev-dev']]
    ])
  })

  it('accepts an available-but-uninstalled entry as a source, and rejects it as installation proof', async () => {
    const run = runner([], [{ ...entry, installed: false }])
    await expect(inspectDevPlugin(run, pluginRoot)).resolves.toBeUndefined()
    await expect(inspectDevPlugin(run, pluginRoot, version)).rejects.toThrow(
      'not enabled at version'
    )
  })

  it('confirms an installed, enabled entry at the generated version', async () => {
    await expect(inspectDevPlugin(runner(), pluginRoot, version)).resolves.toBeUndefined()
  })

  it('propagates a CLI failure instead of reporting a verified source', async () => {
    const run = vi.fn<(args: string[]) => Promise<unknown>>().mockRejectedValue(new Error('no CLI'))
    await expect(inspectDevPlugin(run, pluginRoot)).rejects.toThrow('no CLI')
  })

  it.each([
    { ...entry, source: { source: 'git', path: pluginRoot } },
    { ...entry, source: { source: 'local', path: '/other/.dev/plugins/tempad-dev-dev' } },
    { ...entry, marketplaceSource: { sourceType: 'git', source: '/checkout/.dev' } },
    { ...entry, marketplaceSource: { sourceType: 'local', source: '/other/.dev' } }
  ])('refuses a different or non-local source before App mutation', async (candidate) => {
    const run = runner([candidate])
    await expect(inspectDevPlugin(run, pluginRoot)).rejects.toThrow('this checkout')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([null, {}, { installed: [], available: [] }, { installed: [entry], available: [entry] }])(
    'refuses malformed or ambiguous discovery',
    async (listed) => {
      await expect(
        inspectDevPlugin(vi.fn().mockResolvedValue(listed), pluginRoot)
      ).rejects.toThrow()
    }
  )

  it.each([
    { ...entry, enabled: false },
    { ...entry, installed: false },
    { ...entry, version: 'old' }
  ])('rejects disabled or stale post-install state', async (installed) => {
    await expect(inspectDevPlugin(runner([installed]), pluginRoot, version)).rejects.toThrow(
      'not enabled at version'
    )
  })
})

describe('App restart and CDP target boundaries', () => {
  it('accepts only browser WebSockets on the verified local CDP listener', () => {
    const url = 'ws://127.0.0.1:9222/devtools/browser/example'
    expect(cdpWebSocketUrl({ webSocketDebuggerUrl: url }, 'http://127.0.0.1:9222')).toBe(url)
    for (const value of [
      undefined,
      'not a url',
      'ws://example.com:9222/devtools/browser/id',
      'ws://127.0.0.1:9333/devtools/browser/id',
      'ws://127.0.0.1:9222/devtools/page/id',
      'ws://user@127.0.0.1:9222/devtools/browser/id',
      'ws://:secret@127.0.0.1:9222/devtools/browser/id'
    ]) {
      expect(() =>
        cdpWebSocketUrl({ webSocketDebuggerUrl: value }, 'http://127.0.0.1:9222')
      ).toThrow()
    }
    expect(() => cdpWebSocketUrl(null, 'http://127.0.0.1:9222')).toThrow()
  })
  it('requires the CDP listener to belong to the exact configured App', () => {
    expect(() => assertCdpOwner('p42\nf10\np42\nf11', [42])).not.toThrow()
    expect(() => assertCdpOwner('p99', [42])).toThrow('configured Codex App')
    expect(() => assertCdpOwner('p42\np99', [42])).toThrow('configured Codex App')
    expect(() => assertCdpOwner('', [42])).toThrow('configured Codex App')
    expect(() => assertCdpOwner('p42', [42, 99])).toThrow('configured Codex App')
  })

  it('allows inherited listeners only within the configured App process tree', () => {
    expect(() => assertCdpOwner('p42\np99\np100', [42], '42 1\n99 42\n100 99')).not.toThrow()
    expect(() => assertCdpOwner('p42\np99', [42], '42 1\n99 1')).toThrow('configured Codex App')
    expect(() => assertCdpOwner('p42\np99', [42], '99 100\n100 99')).toThrow('configured Codex App')
    expect(() => assertCdpOwner('p99', [42], '99 42')).toThrow('configured Codex App')
  })
  it('selects only the configured executable, never a helper, another app, or a prefix match', () => {
    const executable = '/Apps/My Codex.app/Contents/MacOS/Codex'
    expect(
      matchingProcesses(
        `1 ${executable}\n2 ${executable} --flag\n3 ${executable}Helper\n4 /Other/Codex\n5 /bin/sh -c ${executable}`,
        executable
      )
    ).toEqual([1, 2])
  })

  it('selects this checkout’s runtime entries wherever they appear in the command', () => {
    const cli = '/checkout/packages/mcp-server/dist/cli.mjs'
    const hub = '/checkout/packages/mcp-server/dist/hub.mjs'
    expect(
      checkoutRuntimeProcesses(
        `1 node ${cli}\n2 node ${hub} --port 1\n3 node /other/dist/cli.mjs\n4 node ${cli}.bak\n5 node`,
        [cli, hub]
      )
    ).toEqual([1, 2])
  })

  it('rejects duplicate detached jobs before restarting', () => {
    expect(() => assertNoRestartJob('PID Status Label\n1 0 com.other.job')).not.toThrow()
    expect(() => assertNoRestartJob('- 0 com.tempad-dev.codex-plugin-reinstall.42.1')).toThrow(
      'already running'
    )
  })

  it('excludes web pages and overlays, and refuses ambiguous App windows', () => {
    const main = 'app://-/index.html'
    const other = 'app://-/index.html?window=other'
    expect(
      selectCodexPageUrl([
        'https://example.com',
        'invalid',
        'app://-/index.html?initialRoute=%2Favatar-overlay',
        'app://-/detached-window.html?initialRoute=%2Fdetached-window',
        main
      ])
    ).toBe(main)
    expect(() => selectCodexPageUrl([main, other])).toThrow('found 2')
    expect(selectCodexPageUrl([main, other], main)).toBe(main)
    expect(selectCodexPageUrl([main, other], 'window=other')).toBe(other)
    expect(() => selectCodexPageUrl([main, main], main)).toThrow('found 2')
    expect(() => selectCodexPageUrl(['https://example.com'])).toThrow('found 0')
  })
})
