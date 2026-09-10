import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertNoDetachedReinstallJobs,
  assertRestartCodexNeeded,
  detachedReinstallIdentity,
  formatCodexConnectionError,
  resolveDevPluginVersion,
  runtimeStateMatches,
  selectCodexTarget,
  type CdpTarget
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

  it('allows restart recovery only when the CDP endpoint is unavailable', () => {
    expect(() => assertRestartCodexNeeded(false)).not.toThrow()
    expect(() => assertRestartCodexNeeded(true)).toThrow(
      'Refusing to restart Codex because its CDP endpoint is already available.'
    )
  })
})

describe('Codex CDP target discovery', () => {
  const page = (title: string, url = 'app://-/index.html'): CdpTarget => ({
    title,
    type: 'page',
    url,
    webSocketDebuggerUrl: 'ws://localhost/page'
  })

  afterEach(() => vi.useRealTimers())

  it('preserves persistent connection failures instead of reporting an empty page list', async () => {
    vi.useFakeTimers()
    const failure = new Error('connect ECONNREFUSED 127.0.0.1:9222')
    const result = selectCodexTarget(vi.fn().mockRejectedValue(failure), undefined, 1000)
    const assertion = expect(result).rejects.toMatchObject({
      message: 'Could not list Codex CDP targets: connect ECONNREFUSED 127.0.0.1:9222',
      cause: failure
    })
    await vi.runAllTimersAsync()
    await assertion
  })

  it('retries a transient failure and selects the recovered app page', async () => {
    vi.useFakeTimers()
    const expected = page('Codex')
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue([expected])
    const result = selectCodexTarget(list, undefined, 1000)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual(expected)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('reports the last successful target list after a connection recovers without an app page', async () => {
    vi.useFakeTimers()
    const list = vi
      .fn()
      .mockRejectedValueOnce('offline')
      .mockResolvedValue([page('Docs', 'https://example.com/')])
    const assertion = expect(selectCodexTarget(list, undefined, 1000)).rejects.toThrow(
      'No Codex app page found at the CDP endpoint. Exposed pages:\n- Docs: https://example.com/'
    )
    await vi.runAllTimersAsync()
    await assertion
  })

  it('reports the latest connection failure instead of a stale target list', async () => {
    vi.useFakeTimers()
    const list = vi.fn().mockResolvedValueOnce([]).mockRejectedValue('offline')
    const assertion = expect(selectCodexTarget(list, undefined, 1000)).rejects.toThrow(
      'Could not list Codex CDP targets: offline'
    )
    await vi.runAllTimersAsync()
    await assertion
  })

  it('excludes overlays, non-page targets and non-app URLs', async () => {
    const expected = page('Codex')
    const list = async () => [
      page('Overlay', 'app://-/index.html?initialRoute=%2Favatar-overlay'),
      { ...page('Worker'), type: 'worker' },
      page('Web', 'https://example.com/'),
      page('Malformed', 'invalid url'),
      expected
    ]
    await expect(selectCodexTarget(list, undefined, 1000)).resolves.toEqual(expected)
  })

  it('preserves ambiguous target identities and permits exact or unique substring selection', async () => {
    const main = page('Main')
    const other = page('Other', 'app://-/index.html?window=other')
    const list = async () => [main, other]
    await expect(selectCodexTarget(list, undefined, 1000)).rejects.toThrow(
      'Multiple Codex pages are available. Pass --page-url with a unique substring:\n' +
        '- Main: app://-/index.html\n- Other: app://-/index.html?window=other'
    )
    await expect(selectCodexTarget(list, main.url, 1000)).resolves.toEqual(main)
    await expect(selectCodexTarget(list, 'window=other', 1000)).resolves.toEqual(other)
  })

  it('keeps multiline diagnostics and bases recovery advice on current endpoint availability', () => {
    const message = 'Multiple Codex pages:\n- Main: app://-/index.html\n- Other: app://-/other.html'
    const reachable = formatCodexConnectionError('http://localhost:9222', message, true)
    expect(reachable).toContain(message)
    expect(reachable).toContain('without restarting Codex')
    expect(reachable).not.toContain('--restart-codex')
    expect(formatCodexConnectionError('http://localhost:9222', 'fetch failed', false)).toContain(
      'pass --restart-codex when the CDP endpoint is unavailable'
    )
  })
})
