import { describe, expect, it } from 'vitest'

import {
  commandIncludesExactPath,
  evaluateActiveExtensionRuntime,
  evaluateRuntimeFreshness,
  evaluateTempadPluginIdentity,
  parseEnabledPlugins,
  parseProcessTable,
  resolveCodexExecutable
} from '@/scripts/agent-authoring-runtime-preflight'

const paths = {
  cli: '/repo/packages/mcp-server/dist/cli.mjs',
  hub: '/repo/packages/mcp-server/dist/hub.mjs'
}

function runtimeProcess(
  path: string,
  pid: number,
  startedAtMs: number
): { command: string; pid: number; ppid: number; startedAtMs: number } {
  return { command: `/usr/bin/node ${path}`, pid, ppid: 1, startedAtMs }
}

describe('agent authoring runtime preflight', () => {
  it('queries plugins with the evaluated desktop host instead of an arbitrary PATH CLI', () => {
    expect(resolveCodexExecutable('/Applications/ChatGPT.app', 'darwin')).toBe(
      '/Applications/ChatGPT.app/Contents/Resources/codex'
    )
    expect(resolveCodexExecutable('/opt/ChatGPT Preview.app', 'darwin')).toBe(
      '/opt/ChatGPT Preview.app/Contents/Resources/codex'
    )
    expect(resolveCodexExecutable('/ignored', 'linux')).toBe('codex')
  })

  it('parses macOS process start times and matches only an exact bundle path token', () => {
    const processes = parseProcessTable(
      [
        `50765 91415 Fri Aug 28 00:42:27 2026 /usr/bin/node ${paths.cli}`,
        `50766 91415 Fri Aug 28 00:42:28 2026 /usr/bin/node ${paths.cli}.backup`
      ].join('\n')
    )

    expect(processes).toHaveLength(2)
    expect(processes[0]).toMatchObject({ pid: 50765, ppid: 91415 })
    expect(Number.isFinite(processes[0]?.startedAtMs)).toBe(true)
    expect(commandIncludesExactPath(processes[0]!.command, paths.cli)).toBe(true)
    expect(commandIncludesExactPath(processes[1]!.command, paths.cli)).toBe(false)
    expect(commandIncludesExactPath(`/usr/bin/node "${paths.cli}"`, paths.cli)).toBe(true)
  })

  it('accepts one fresh Hub and one or more fresh exact-checkout CLIs', () => {
    const result = evaluateRuntimeFreshness(paths, { cli: 19_500, hub: 19_500 }, [
      runtimeProcess(paths.cli, 1, 20_000),
      runtimeProcess(paths.cli, 2, 21_000),
      runtimeProcess(paths.hub, 3, 20_000),
      runtimeProcess('/other/packages/mcp-server/dist/cli.mjs', 4, 5_000)
    ])

    expect(result.cli.map(({ pid }) => pid)).toEqual([1, 2])
    expect(result.hub.map(({ pid }) => pid)).toEqual([3])
    expect(result.issues).toEqual([])
  })

  it('rejects either stale bundle process independently', () => {
    const staleCli = evaluateRuntimeFreshness(paths, { cli: 20_500, hub: 10_000 }, [
      runtimeProcess(paths.cli, 1, 19_000),
      runtimeProcess(paths.hub, 2, 20_000)
    ])
    const staleHub = evaluateRuntimeFreshness(paths, { cli: 10_000, hub: 20_500 }, [
      runtimeProcess(paths.cli, 1, 20_000),
      runtimeProcess(paths.hub, 2, 19_000)
    ])

    expect(staleCli.issues.map(({ code }) => code)).toContain('RUNTIME_STALE_CLI')
    expect(staleHub.issues.map(({ code }) => code)).toContain('RUNTIME_STALE_HUB')

    const sameSecond = evaluateRuntimeFreshness(paths, { cli: 20_500, hub: 20_500 }, [
      runtimeProcess(paths.cli, 1, 20_000),
      runtimeProcess(paths.hub, 2, 20_000)
    ])
    expect(sameSecond.issues.map(({ code }) => code)).toEqual([
      'RUNTIME_STALE_CLI',
      'RUNTIME_STALE_HUB'
    ])
  })

  it('rejects absent, partial, and multiple-Hub runtime states', () => {
    const mtimes = { cli: 10_000, hub: 10_000 }
    expect(evaluateRuntimeFreshness(paths, mtimes, []).issues.map(({ code }) => code)).toEqual([
      'RUNTIME_ABSENT'
    ])
    expect(
      evaluateRuntimeFreshness(paths, mtimes, [runtimeProcess(paths.cli, 1, 20_000)]).issues.map(
        ({ code }) => code
      )
    ).toContain('RUNTIME_PARTIAL')
    expect(
      evaluateRuntimeFreshness(paths, mtimes, [
        runtimeProcess(paths.cli, 1, 20_000),
        runtimeProcess(paths.hub, 2, 20_000),
        runtimeProcess(paths.hub, 3, 20_000)
      ]).issues.map(({ code }) => code)
    ).toContain('RUNTIME_MULTIPLE_HUBS')
  })

  it('requires the exact active browser-extension checkout before dispatch', () => {
    const expectedFingerprint = 'a'.repeat(64)
    const hub = runtimeProcess(paths.hub, 3, 20_000)
    const matching = {
      activeExtension: {
        connectedAt: '2026-08-28T00:00:00.000Z',
        fingerprint: expectedFingerprint,
        id: 'extension-1',
        version: '0.21.0'
      },
      expectedExtensionRuntimeFingerprint: expectedFingerprint,
      processId: hub.pid
    }

    expect(evaluateActiveExtensionRuntime(expectedFingerprint, [hub], matching).issues).toEqual([])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], {
        ...matching,
        activeExtension: {
          ...matching.activeExtension,
          fingerprint: 'b'.repeat(64)
        }
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_EXTENSION_FINGERPRINT_MISMATCH'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], {
        ...matching,
        activeExtension: null
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_EXTENSION_INACTIVE'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], {
        ...matching,
        processId: 4
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_IDENTITY_RECORD_STALE'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], {
        ...matching,
        expectedExtensionRuntimeFingerprint: 'b'.repeat(64)
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_HUB_EXTENSION_EXPECTATION_MISMATCH'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], {
        ...matching,
        activeExtension: { ...matching.activeExtension, fingerprint: null }
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_EXTENSION_IDENTITY_MISSING'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], null).issues.map(
        ({ code }) => code
      )
    ).toEqual(['RUNTIME_IDENTITY_RECORD_MISSING'])
  })

  it('parses enabled Codex plugins and requires the generated TemPad cachebuster', () => {
    const plugins = parseEnabledPlugins(
      [
        'tempad-dev-dev@tempad-dev-dev  installed, enabled  0.1.2+codex.2  /repo/.dev/plugins/tempad-dev-dev',
        'documents@openai-primary-runtime  installed, enabled  26.826.1  /plugins/documents',
        'pdf@openai-primary-runtime  not installed                 /plugins/pdf'
      ].join('\n')
    )

    expect(plugins).toHaveLength(2)
    expect(evaluateTempadPluginIdentity('0.1.2+codex.2', plugins).issues).toEqual([])
    expect(
      evaluateTempadPluginIdentity('0.1.2+codex.3', plugins).issues.map(({ code }) => code)
    ).toEqual(['TEMPAD_PLUGIN_VERSION_MISMATCH'])
    expect(evaluateTempadPluginIdentity('0.1.2+codex.2', []).issues[0]?.code).toBe(
      'TEMPAD_PLUGIN_NOT_ENABLED'
    )
  })
})
