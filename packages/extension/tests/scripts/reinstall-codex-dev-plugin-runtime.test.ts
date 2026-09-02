import { describe, expect, it } from 'vitest'

import {
  assertNoDetachedReinstallJobs,
  detachedReinstallIdentity,
  resolveDevPluginVersion,
  runtimeStateMatches
} from '@/scripts/reinstall-codex-dev-plugin-runtime'

describe('Codex plugin reinstall runtime state', () => {
  it('uses the generated plugin version by default and rejects an explicit mismatch', () => {
    const manifest = { name: 'tempad-dev-dev', version: '0.1.2+codex.test' }

    expect(resolveDevPluginVersion(manifest)).toBe('0.1.2+codex.test')
    expect(resolveDevPluginVersion(manifest, '0.1.2+codex.test')).toBe('0.1.2+codex.test')
    expect(() => resolveDevPluginVersion(manifest, '0.1.2+codex.other')).toThrow(
      'Generated plugin version is 0.1.2+codex.test, not 0.1.2+codex.other.'
    )
  })

  it('requires every CLI and Hub process to stop before reinstalling', () => {
    expect(runtimeStateMatches({ cli: [], hub: [] }, 'uninstalled')).toBe(true)
    expect(runtimeStateMatches({ cli: [{ pid: 1 }], hub: [] }, 'uninstalled')).toBe(false)
    expect(runtimeStateMatches({ cli: [], hub: [{ pid: 2 }] }, 'uninstalled')).toBe(false)
    expect(runtimeStateMatches({ cli: [{ pid: 1 }], hub: [{ pid: 2 }] }, 'uninstalled')).toBe(false)
  })

  it('requires a new CLI and an available Hub after installation', () => {
    const baseline = { cli: [{ pid: 1 }], hub: [] }

    expect(
      runtimeStateMatches({ cli: [{ pid: 1 }], hub: [{ pid: 2 }] }, 'installed', baseline)
    ).toBe(false)
    expect(
      runtimeStateMatches(
        { cli: [{ pid: 1 }, { pid: 3 }], hub: [{ pid: 2 }] },
        'installed',
        baseline
      )
    ).toBe(true)
  })

  it('gives each detached restart an isolated job and log', () => {
    expect(detachedReinstallIdentity(42, 1_787_422_000_000)).toEqual({
      jobLabel: 'com.tempad-dev.codex-plugin-reinstall.42.1787422000000',
      logFileName: 'codex-plugin-reinstall.42.1787422000000.log'
    })
  })

  it('rejects a second detached restart while one is active', () => {
    expect(() => assertNoDetachedReinstallJobs([])).not.toThrow()
    expect(() =>
      assertNoDetachedReinstallJobs(['com.tempad-dev.codex-plugin-reinstall.42.1'])
    ).toThrow(
      'A detached Codex plugin reinstall is already running: ' +
        'com.tempad-dev.codex-plugin-reinstall.42.1'
    )
  })
})
