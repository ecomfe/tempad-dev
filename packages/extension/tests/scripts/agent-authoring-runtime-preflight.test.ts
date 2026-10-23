import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  evaluateActiveExtensionRuntime,
  evaluateRuntimeProcesses,
  evaluateTempadPluginIdentity,
  extractDevelopmentBundleFingerprint,
  listRuntimeProcesses,
  parseEnabledPlugins,
  parseProcessTable,
  processRunsRuntimeEntry,
  resolveCodexExecutable,
  resolveDefaultRuntimeDir,
  runPreflight
} from '@/scripts/agent-authoring-runtime-preflight'

const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: exec })
}))

const paths = {
  cli: '/repo/packages/mcp-server/dist/cli.mjs',
  hub: '/repo/packages/mcp-server/dist/hub.mjs'
}

function runtimeProcess(path: string, pid: number, startedAtMs: number) {
  return {
    command: `/usr/bin/node ${path}`,
    executable: '/usr/bin/node',
    pid,
    ppid: 1,
    startedAtMs
  }
}

describe('agent authoring runtime preflight', () => {
  it.each([
    { copiedManifest: false, symlinkCheckout: false },
    { copiedManifest: true, symlinkCheckout: false },
    { copiedManifest: false, symlinkCheckout: true }
  ])(
    'requires entries from this checkout (copied: $copiedManifest, symlink: $symlinkCheckout)',
    async ({ copiedManifest, symlinkCheckout }) => {
      const directory = mkdtempSync(join(tmpdir(), 'tempad-preflight-checkout-'))
      const physicalCheckout = join(directory, 'checkout')
      const checkout = symlinkCheckout ? join(directory, 'checkout-link') : physicalCheckout
      const pluginRoot = join(checkout, '.dev/plugins/tempad-dev-dev')
      const runtimeRoot = copiedManifest ? join(directory, 'old-checkout') : physicalCheckout
      const cli = join(runtimeRoot, 'packages/mcp-server/dist/cli.mjs')
      const hub = join(runtimeRoot, 'packages/mcp-server/dist/hub.mjs')
      const runtimeDir = join(directory, 'run')
      const appPath = join(directory, 'Host.app')
      const fingerprint = 'a'.repeat(64)
      const version = '0.1.2+codex.fixture'
      const write = (path: string, text: string) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      }
      const writeJson = (path: string, value: unknown) => write(path, JSON.stringify(value))
      try {
        mkdirSync(physicalCheckout)
        if (symlinkCheckout) symlinkSync(physicalCheckout, checkout, 'junction')
        write(cli, '')
        write(hub, '')
        write(
          resolveCodexExecutable(appPath, 'darwin', () => false),
          ''
        )
        writeJson(join(pluginRoot, '.codex-plugin/plugin.json'), {
          name: 'tempad-dev-dev',
          version
        })
        writeJson(join(pluginRoot, '.mcp.json'), {
          mcpServers: {
            'tempad-dev-dev': {
              command: 'node',
              args: [cli],
              env: { TEMPAD_MCP_RUNTIME_DIR: runtimeDir }
            }
          }
        })
        writeJson(join(runtimeDir, 'hub-runtime.json'), {
          processId: 102,
          activeExtension: {
            connectedAt: '2026-10-01T00:00:00.000Z',
            fingerprint,
            id: 'extension-fixture',
            version: '0.23.5'
          }
        })
        write(
          join(checkout, 'scripts/extension-runtime-fingerprint.mjs'),
          `export const computeExtensionRuntimeFingerprint = () => '${fingerprint}'`
        )
        exec.mockImplementation(async (executable: string, args: string[]) => {
          if (executable !== 'ps') {
            return {
              stdout: `tempad-dev-dev@tempad-dev-dev installed, enabled ${version} ${pluginRoot}`
            }
          }
          return {
            stdout: /,(?:comm|exe)=$/.test(args.at(-1) ?? '')
              ? '101 1 Thu Oct 01 00:00:00 2026 /usr/bin/node\n102 1 Thu Oct 01 00:00:00 2026 /usr/bin/node'
              : `101 1 Thu Oct 01 00:00:00 2026 node ${cli}\n102 1 Thu Oct 01 00:00:00 2026 node ${hub}`
          }
        })
        const preflight = runPreflight({ appPath, checkout })
        if (copiedManifest) {
          await expect(preflight).rejects.toThrow('this checkout')
          expect(exec).not.toHaveBeenCalled()
        } else {
          await expect(preflight).resolves.toMatchObject({ valid: true })
        }
      } finally {
        exec.mockReset()
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )

  it.each([
    ['darwin', 'comm'],
    ['linux', 'exe']
  ] as const)('uses native executable paths on %s', async (platform, field) => {
    const prefix = '101 1 Thu Oct 01 00:00:00 2026 '
    exec.mockImplementation(async (_executable: string, args: string[]) => ({
      stdout: prefix + (args.at(-1)?.endsWith(`,${field}=`) ? '/usr/bin/node' : `node ${paths.cli}`)
    }))
    try {
      const processes = await listRuntimeProcesses(platform)
      expect(evaluateRuntimeProcesses(paths, processes).cli.map(({ pid }) => pid)).toEqual([101])
      expect(exec.mock.calls.map(([, args]) => args)).toEqual([
        ['-axww', '-o', 'pid=,ppid=,lstart=,command='],
        ['-axww', '-o', `pid=,ppid=,lstart=,${field}=`]
      ])
    } finally {
      exec.mockReset()
    }
  })

  it.skipIf(process.platform === 'win32')(
    'locates the same private Linux root as the Hub, retaining a safe legacy runtime',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'tempad-preflight-path-'))
      const legacyRoot = join(directory, 'tempad-dev')
      const isolated = join(directory, `tempad-dev-${process.getuid!()}`, 'run')
      try {
        expect(resolveDefaultRuntimeDir(directory, 'linux')).toBe(join(legacyRoot, 'run'))
        expect(existsSync(legacyRoot)).toBe(false)
        mkdirSync(legacyRoot, { mode: 0o700 })
        expect(resolveDefaultRuntimeDir(directory, 'linux')).toBe(join(legacyRoot, 'run'))
        expect(resolveDefaultRuntimeDir(directory, 'linux', process.getuid!() + 1)).toBe(
          join(directory, `tempad-dev-${process.getuid!() + 1}`, 'run')
        )
        chmodSync(legacyRoot, 0o755)
        expect(resolveDefaultRuntimeDir(directory, 'linux')).toBe(isolated)
        rmSync(legacyRoot, { recursive: true })
        symlinkSync(directory, legacyRoot)
        expect(resolveDefaultRuntimeDir(directory, 'linux')).toBe(isolated)
        expect(resolveDefaultRuntimeDir(directory, 'darwin')).toBe(join(legacyRoot, 'run'))
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  )
  it('reads one unambiguous development bundle fingerprint', () => {
    const fingerprint = 'a'.repeat(64)
    expect(
      extractDevelopmentBundleFingerprint(`const runtimeFingerprint = "${fingerprint}";`)
    ).toBe(fingerprint)
    expect(extractDevelopmentBundleFingerprint('const runtimeFingerprint = "invalid";')).toBeNull()
    expect(
      extractDevelopmentBundleFingerprint(
        `const runtimeFingerprint = "${fingerprint}"; let runtimeFingerprint = '${'b'.repeat(64)}';`
      )
    ).toBeNull()
  })

  it('queries plugins with the evaluated desktop host instead of an arbitrary PATH CLI', () => {
    const legacyExists = (path: string) => path.endsWith('/Resources/codex')
    expect(resolveCodexExecutable('/Applications/ChatGPT.app', 'darwin', legacyExists)).toBe(
      '/Applications/ChatGPT.app/Contents/Resources/codex'
    )
    expect(resolveCodexExecutable('/opt/ChatGPT Preview.app', 'darwin', legacyExists)).toBe(
      '/opt/ChatGPT Preview.app/Contents/Resources/codex'
    )
    expect(resolveCodexExecutable('/ignored', 'linux')).toBe('codex')
  })

  it('prefers the nested host CLI and never falls back to PATH when the bundle is missing', () => {
    const nested =
      '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
    for (const exists of [(path: string) => path === nested, () => true, () => false]) {
      expect(resolveCodexExecutable('/Applications/ChatGPT.app', 'darwin', exists)).toBe(nested)
    }
  })

  it('parses matching process snapshots and matches only a direct exact entry', () => {
    const processes = parseProcessTable(
      [
        `50765 91415 Fri Aug 28 00:42:27 2026 /usr/bin/node ${paths.cli}`,
        `50766 91415 Fri Aug 28 00:42:28 2026 /usr/bin/node ${paths.cli}.backup`
      ].join('\n'),
      [
        '50765 91415 Fri Aug 28 00:42:27 2026 /usr/bin/node',
        '50766 91415 Fri Aug 28 00:42:28 2026 /usr/bin/node'
      ].join('\n')
    )

    expect(processes).toHaveLength(2)
    expect(processes[0]).toMatchObject({ pid: 50765, ppid: 91415 })
    expect(Number.isFinite(processes[0]?.startedAtMs)).toBe(true)
    expect(processRunsRuntimeEntry(processes[0]!, paths.cli)).toBe(true)
    expect(processRunsRuntimeEntry(processes[1]!, paths.cli)).toBe(false)
    expect(
      processRunsRuntimeEntry(
        { ...processes[0]!, command: `/usr/bin/node "${paths.cli}"` },
        paths.cli
      )
    ).toBe(true)
  })

  it('does not infer executable ownership from unmatched or replaced process rows', () => {
    const commands = [1, 2, 3, 4].map(
      (pid) => `${pid} 9 Fri Aug 28 00:42:27 2026 /usr/bin/node ${paths.cli}`
    )
    const processes = parseProcessTable(
      commands.join('\n'),
      [
        '1 9 Fri Aug 28 00:42:28 2026 /usr/bin/node',
        '2 10 Fri Aug 28 00:42:27 2026 /usr/bin/node',
        '4 9 Fri Aug 28 00:42:27 2026 /usr/bin/node'
      ].join('\n')
    )
    expect(processes.map(({ executable }) => executable)).toEqual([
      null,
      null,
      null,
      '/usr/bin/node'
    ])
    expect(evaluateRuntimeProcesses(paths, processes).cli.map(({ pid }) => pid)).toEqual([4])
    expect(evaluateRuntimeProcesses(paths, processes.slice(0, 3)).issues).toContainEqual(
      expect.objectContaining({ code: 'RUNTIME_ABSENT' })
    )
  })

  it('accepts one Hub and one or more exact-checkout CLIs', () => {
    const result = evaluateRuntimeProcesses(paths, [
      runtimeProcess(paths.cli, 1, 20_000),
      runtimeProcess(paths.cli, 2, 21_000),
      runtimeProcess(paths.hub, 3, 20_000),
      runtimeProcess('/other/packages/mcp-server/dist/cli.mjs', 4, 5_000)
    ])

    expect(result.cli.map(({ pid }) => pid)).toEqual([1, 2])
    expect(result.hub.map(({ pid }) => pid)).toEqual([3])
    expect(result.issues).toEqual([])
  })

  it('rejects absent, partial, and multiple-Hub runtime states', () => {
    expect(evaluateRuntimeProcesses(paths, []).issues.map(({ code }) => code)).toEqual([
      'RUNTIME_ABSENT'
    ])
    expect(
      evaluateRuntimeProcesses(paths, [runtimeProcess(paths.cli, 1, 20_000)]).issues.map(
        ({ code }) => code
      )
    ).toContain('RUNTIME_PARTIAL')
    expect(
      evaluateRuntimeProcesses(paths, [
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
      evaluateActiveExtensionRuntime(
        expectedFingerprint,
        [hub],
        {
          ...matching,
          activeExtension: { ...matching.activeExtension, fingerprint: 'b'.repeat(64) }
        },
        'b'.repeat(64)
      ).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_DEVELOPMENT_BUNDLE_STALE'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], matching, 'b'.repeat(64)).issues
    ).toEqual([])
    expect(
      evaluateActiveExtensionRuntime(
        expectedFingerprint,
        [hub],
        {
          ...matching,
          activeExtension: { ...matching.activeExtension, fingerprint: 'b'.repeat(64) }
        },
        expectedFingerprint
      ).issues[0]?.message
    ).toContain('the development bundle is current')
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
        activeExtension: { ...matching.activeExtension, fingerprint: null }
      }).issues.map(({ code }) => code)
    ).toEqual(['RUNTIME_EXTENSION_IDENTITY_MISSING'])
    expect(
      evaluateActiveExtensionRuntime(expectedFingerprint, [hub], null).issues.map(
        ({ code }) => code
      )
    ).toEqual(['RUNTIME_IDENTITY_RECORD_MISSING'])
  })

  it('reports the owned Hub startup fingerprint without treating it as a compatibility gate', () => {
    const extensionFingerprint = 'a'.repeat(64)
    const hubFingerprint = 'b'.repeat(64)
    const hub = runtimeProcess(paths.hub, 3, 20_000)
    const identity = {
      activeExtension: {
        connectedAt: '2026-08-28T00:00:00.000Z',
        fingerprint: extensionFingerprint,
        id: 'extension-1',
        version: '0.21.0'
      },
      processId: hub.pid,
      runtimeFingerprint: hubFingerprint
    }
    const evaluate = (value: unknown) =>
      evaluateActiveExtensionRuntime(extensionFingerprint, [hub], value)

    expect(evaluate(identity)).toMatchObject({ hubRuntimeFingerprint: hubFingerprint, issues: [] })
    for (const runtimeFingerprint of [undefined, null, 'invalid']) {
      expect(evaluate({ ...identity, runtimeFingerprint })).toMatchObject({
        hubRuntimeFingerprint: null,
        issues: []
      })
    }
    expect(evaluate({ ...identity, activeExtension: null }).hubRuntimeFingerprint).toBe(
      hubFingerprint
    )
    expect(evaluate({ ...identity, processId: 4 })).toMatchObject({
      hubRuntimeFingerprint: null,
      issues: [{ code: 'RUNTIME_IDENTITY_RECORD_STALE' }]
    })
    expect(evaluate(null).hubRuntimeFingerprint).toBeNull()
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
