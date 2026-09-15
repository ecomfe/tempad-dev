import { describe, expect, it, vi } from 'vitest'

import {
  devPluginId,
  parseReinstallArguments,
  reinstallDevPlugin,
  resolveDevPluginVersion
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
const added = { pluginId: devPluginId, version, installedPath: '/cache/plugin' }

function runner(
  initial: unknown = { installed: [entry], available: [] },
  result: unknown = added,
  final: unknown = { installed: [entry] }
) {
  return vi
    .fn<(args: string[]) => Promise<unknown>>()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce(final)
}

describe('Codex plugin reinstall arguments', () => {
  it('defaults to the generated version and permits an exact requested version', () => {
    const manifest = { name: 'tempad-dev-dev', version }
    expect(resolveDevPluginVersion(manifest)).toBe(version)
    expect(resolveDevPluginVersion(manifest, version)).toBe(version)
    expect(() => resolveDevPluginVersion(manifest, 'old')).toThrow('not old')
    expect(() => resolveDevPluginVersion(null)).toThrow('must be an object')
    expect(() => resolveDevPluginVersion({ name: 'another', version })).toThrow(
      'unexpected identity'
    )
  })

  it('accepts the host and timeout options without requiring CDP', () => {
    expect(parseReinstallArguments([])).toEqual({ timeoutMs: 60000 })
    expect(
      parseReinstallArguments([version, '--app-path', '/Apps/Codex.app', '--timeout-ms', '2500'])
    ).toEqual({
      version,
      appPath: '/Apps/Codex.app',
      timeoutMs: 2500
    })
    expect(parseReinstallArguments(['--help'])).toBeNull()
  })

  it.each(['--restart-codex', '--resume-after-restart', '--cdp-url', '--page-url'])(
    'rejects unsupported option %s before installation',
    (option) => {
      expect(() => parseReinstallArguments([option])).toThrow('Unknown option')
    }
  )

  it.each([
    ['--timeout-ms', '0'],
    ['--timeout-ms', 'NaN'],
    ['--timeout-ms', '1.5'],
    ['--app-path'],
    ['--unknown'],
    ['one', 'two']
  ])('rejects invalid arguments %j', (...args) => {
    expect(() => parseReinstallArguments(args)).toThrow()
  })
})

describe('Codex CLI plugin replacement', () => {
  it('updates an existing plugin and verifies its enabled version without uninstall or restart', async () => {
    const run = runner({ installed: [{ ...entry, version: 'old' }], available: [] })
    await expect(reinstallDevPlugin(run, pluginRoot, version)).resolves.toBe('/cache/plugin')
    expect(run.mock.calls).toEqual([
      [['plugin', 'list', '--available', '--json', '--marketplace', 'tempad-dev-dev']],
      [['plugin', 'add', devPluginId, '--json']],
      [['plugin', 'list', '--json', '--marketplace', 'tempad-dev-dev']]
    ])
  })

  it('installs an available local plugin after an interrupted uninstall', async () => {
    const run = runner({ installed: [], available: [{ ...entry, installed: false }] })
    await expect(reinstallDevPlugin(run, pluginRoot, version)).resolves.toBe('/cache/plugin')
  })

  it.each([
    { ...entry, source: { source: 'git', path: pluginRoot } },
    { ...entry, source: { source: 'local', path: '/other/.dev/plugins/tempad-dev-dev' } },
    { ...entry, marketplaceSource: { sourceType: 'git', source: '/checkout/.dev' } },
    { ...entry, marketplaceSource: { sourceType: 'local', source: '/other/.dev' } }
  ])('refuses a different or non-local source before any write', async (candidate) => {
    const run = runner({ installed: [candidate], available: [] })
    await expect(reinstallDevPlugin(run, pluginRoot, version)).rejects.toThrow('this checkout')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it.each([null, {}, { installed: [], available: [] }, { installed: [entry], available: [entry] }])(
    'refuses missing, malformed, or ambiguous discovery before any write',
    async (listed) => {
      const run = runner(listed)
      await expect(reinstallDevPlugin(run, pluginRoot, version)).rejects.toThrow()
      expect(run).toHaveBeenCalledTimes(1)
    }
  )

  it('propagates CLI failure without retrying or removing the existing plugin', async () => {
    const failure = new Error('plugin command unavailable')
    const run = vi.fn().mockRejectedValue(failure)
    await expect(reinstallDevPlugin(run, pluginRoot, version)).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects an unexpected version returned by installation', async () => {
    const run = runner(undefined, { ...added, version: 'old' })
    await expect(reinstallDevPlugin(run, pluginRoot, version)).rejects.toThrow(
      'did not confirm installation'
    )
    expect(run).toHaveBeenCalledTimes(2)
  })

  it.each([
    { ...entry, enabled: false },
    { ...entry, installed: false },
    { ...entry, version: 'old' }
  ])('rejects success when the installed plugin is disabled or stale', async (installed) => {
    await expect(
      reinstallDevPlugin(
        runner(undefined, undefined, { installed: [installed] }),
        pluginRoot,
        version
      )
    ).rejects.toThrow('not enabled at version')
  })
})
