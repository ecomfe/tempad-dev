import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codegen: vi.fn(),
  notify: vi.fn()
}))

vi.mock('@/utils', () => ({
  codegen: mocks.codegen
}))

vi.mock('@/plugins/available-plugins.json', () => ({
  default: [{ name: 'snapshot-plugin', url: 'https://snapshot/plugin.js' }]
}))

import { usePluginInstall } from '@/composables/plugin'

type MockResponse = {
  status?: number
  text?: () => Promise<string>
  json?: () => Promise<unknown>
}

describe('composables/plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('figma', {
      notify: mocks.notify
    })
    vi.stubGlobal('fetch', vi.fn())
    mocks.codegen.mockReset()
    mocks.notify.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('installs from direct URL and shows install toast', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'DemoPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/plugin.js')

    expect(installed).toEqual({
      code: 'export default {}',
      pluginName: 'DemoPlugin',
      source: 'https://cdn/plugin.js'
    })
    expect(plugin.validity.value).toBe('')
    expect(plugin.installing.value).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('Plugin "DemoPlugin" installed successfully.')
  })

  it('shows update toast when install is called in update mode', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'UpdatePlugin' })

    const plugin = usePluginInstall()
    await plugin.install('https://cdn/update.js', true)

    expect(mocks.notify).toHaveBeenCalledWith('Plugin "UpdatePlugin" updated successfully.')
  })

  it('resolves registered source from remote registry', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        json: async () => [{ name: 'registered-plugin', url: 'https://registry/plugin.js' }]
      } satisfies MockResponse)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => 'export default {}'
      } satisfies MockResponse)
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'RegisteredPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('@registered-plugin')

    expect(installed?.source).toBe('@registered-plugin')
    expect(fetchMock.mock.calls[0]?.[0]).toMatch('available-plugins.json')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://registry/plugin.js')
  })

  it('falls back to snapshot registry when remote registry fetch fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce(new Error('registry down')).mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'SnapshotPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('@snapshot-plugin')

    expect(installed?.pluginName).toBe('SnapshotPlugin')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://snapshot/plugin.js')
  })

  it('reports unregistered plugin names as fetch failures', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      json: async () => []
    } satisfies MockResponse)

    const plugin = usePluginInstall()
    const installed = await plugin.install('@missing-plugin')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe(
      'Failed to fetch the script content: "missing-plugin" is not a registered plugin.'
    )
  })

  it('reports non-200 responses as fetch failures', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 500,
      text: async () => 'bad'
    } satisfies MockResponse)

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/404.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to fetch the script content: 404: Not Found')
  })

  it('handles empty plugin names from codegen result', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockResolvedValueOnce({ pluginName: '' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/no-name.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('The plugin name must not be empty.')
  })

  it('handles codegen failures with unknown error payloads', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockRejectedValueOnce('boom')

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/eval-error.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to evaluate the code: Unknown error')
  })

  it('handles codegen failures with Error instances', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      status: 200,
      text: async () => 'export default {}'
    } satisfies MockResponse)
    mocks.codegen.mockRejectedValueOnce(new Error('invalid plugin output'))

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/eval-error-message.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to evaluate the code: invalid plugin output')
  })

  it('handles non-Error fetch failures with network fallback message', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockRejectedValueOnce('offline')

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/network-error.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to fetch the script content: Network error')
  })

  it('supports canceling a pending install and aborting stale controller on retry', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    let resolveFirstFetch: (value: MockResponse) => void = () => undefined
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = (value) => resolve(value)
          })
      )
      .mockResolvedValueOnce({
        status: 200,
        text: async () => 'export default {}'
      } satisfies MockResponse)

    mocks.codegen.mockResolvedValueOnce({ pluginName: 'RetriedPlugin' })

    const plugin = usePluginInstall()

    const first = plugin.install('https://cdn/slow.js')
    expect(plugin.installing.value).toBe(true)

    plugin.cancel()
    expect(plugin.installing.value).toBe(false)

    const retried = await plugin.install('https://cdn/retry.js')
    expect(retried?.pluginName).toBe('RetriedPlugin')
    expect(abortSpy).toHaveBeenCalledTimes(2)

    resolveFirstFetch({
      status: 500,
      text: async () => ''
    })
    await first
  })

  it('returns early when install is called while an install is already running', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined))

    const plugin = usePluginInstall()

    void plugin.install('https://cdn/long.js')
    const second = await plugin.install('https://cdn/second.js')

    expect(second).toBeNull()
  })
})
