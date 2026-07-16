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

import {
  isAllowedPluginSource,
  MAX_PLUGIN_SOURCE_BYTES,
  usePluginInstall
} from '@/composables/plugin'

type MockResponse = {
  body?: ReadableStream<Uint8Array> | null
  headers?: { get: (name: string) => string | null }
  status?: number
  statusText?: string
  text?: () => Promise<string>
  url?: string
}

function response(input: MockResponse = {}): MockResponse {
  return {
    headers: { get: () => null },
    status: 200,
    statusText: '',
    text: async () => '',
    url: '',
    ...input
  }
}

let fetchMock: ReturnType<typeof vi.fn>

describe('composables/plugin', () => {
  beforeEach(() => {
    vi.stubGlobal('figma', {
      notify: mocks.notify
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mocks.codegen.mockReset()
    mocks.notify.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('installs from direct URL and shows install toast', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'DemoPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/plugin.js')

    expect(installed).toEqual({
      code: 'export default {}',
      integrity: 'sha256:9aeb8d59b4d483ca6298e9a450fbf37dfd2b4c63990135ab1d040d76314087ec',
      pluginName: 'DemoPlugin',
      resolvedUrl: 'https://cdn/plugin.js',
      source: 'https://cdn/plugin.js'
    })
    expect(plugin.validity.value).toBe('')
    expect(plugin.installing.value).toBe(false)
    expect(mocks.notify).toHaveBeenCalledWith('Plugin "DemoPlugin" installed successfully.')
  })

  it('shows update toast when install is called in update mode', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'UpdatePlugin' })

    const plugin = usePluginInstall()
    await plugin.install('https://cdn/update.js', true)

    expect(mocks.notify).toHaveBeenCalledWith('Plugin "UpdatePlugin" updated successfully.')
  })

  it('resolves registered source from remote registry', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          text: async () =>
            JSON.stringify([{ name: 'registered-plugin', url: 'https://registry/plugin.js' }])
        })
      )
      .mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'RegisteredPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('@registered-plugin')

    expect(installed?.source).toBe('@registered-plugin')
    expect(fetchMock.mock.calls[0]?.[0]).toMatch('available-plugins.json')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://registry/plugin.js')
  })

  it('falls back to snapshot registry when remote registry fetch fails', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('registry down'))
      .mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'SnapshotPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('@snapshot-plugin')

    expect(installed?.pluginName).toBe('SnapshotPlugin')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://snapshot/plugin.js')
  })

  it('reports unregistered plugin names as fetch failures', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => '[]' }))

    const plugin = usePluginInstall()
    const installed = await plugin.install('@missing-plugin')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe(
      'Failed to fetch the script content: "missing-plugin" is not a registered plugin.'
    )
  })

  it('reports non-200 responses as fetch failures', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        status: 500,
        text: async () => 'bad'
      })
    )

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/404.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to fetch the script content: 500: Request failed')
  })

  it('handles empty plugin names from codegen result', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: '' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/no-name.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('The plugin name must not be empty.')
  })

  it.each([
    ['unknown payloads', 'boom', 'Unknown error'],
    ['Error instances', new Error('invalid plugin output'), 'invalid plugin output']
  ])('reports codegen failures from %s', async (_case, error, message) => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockRejectedValueOnce(error)

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/eval-error.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe(`Failed to evaluate the code: ${message}`)
  })

  it('handles non-Error fetch failures with network fallback message', async () => {
    fetchMock.mockRejectedValueOnce('offline')

    const plugin = usePluginInstall()
    const installed = await plugin.install('https://cdn/network-error.js')

    expect(installed).toBeNull()
    expect(plugin.validity.value).toBe('Failed to fetch the script content: Network error')
  })

  it('cancels a pending install without allowing its stale result to win', async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

    let resolveFirstFetch: (value: MockResponse) => void = () => undefined
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstFetch = (value) => resolve(value)
          })
      )
      .mockResolvedValueOnce(response({ text: async () => 'export default {}' }))

    mocks.codegen.mockResolvedValueOnce({ pluginName: 'RetriedPlugin' })

    const plugin = usePluginInstall()

    const first = plugin.install('https://cdn/slow.js')
    expect(plugin.installing.value).toBe(true)

    plugin.cancel()
    expect(plugin.installing.value).toBe(false)

    const retried = await plugin.install('https://cdn/retry.js')
    expect(retried?.pluginName).toBe('RetriedPlugin')
    expect(abortSpy).toHaveBeenCalledOnce()

    resolveFirstFetch(
      response({
        status: 500,
        text: async () => ''
      })
    )
    expect(await first).toBeNull()
    expect(plugin.validity.value).toBe('')
  })

  it('returns early when install is called while an install is already running', async () => {
    let resolveFirstFetch!: (value: MockResponse) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstFetch = resolve as (value: MockResponse) => void
        })
    )

    const plugin = usePluginInstall()

    const first = plugin.install('https://cdn/long.js')
    const second = await plugin.install('https://cdn/second.js')

    expect(second).toBeNull()

    resolveFirstFetch(
      response({
        status: 500,
        text: async () => ''
      })
    )
    await first
  })

  it('accepts registered, HTTPS, and loopback development sources only', () => {
    expect(isAllowedPluginSource('@nuxt/pro')).toBe(true)
    expect(isAllowedPluginSource('https://cdn.example/plugin.js')).toBe(true)
    expect(isAllowedPluginSource('http://localhost:5173/plugin.js')).toBe(true)
    expect(isAllowedPluginSource('http://127.0.0.1/plugin.js')).toBe(true)
    expect(isAllowedPluginSource('http://[::1]/plugin.js')).toBe(true)

    expect(isAllowedPluginSource('@nuxt/pro?next')).toBe(false)
    expect(isAllowedPluginSource('http://cdn.example/plugin.js')).toBe(false)
    expect(isAllowedPluginSource('javascript:alert(1)')).toBe(false)
    expect(isAllowedPluginSource('https://user:secret@cdn.example/plugin.js')).toBe(false)
  })

  it('does not misclassify URLs containing @ as registered plugin names', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'VersionedPlugin' })

    const plugin = usePluginInstall()
    await plugin.install('https://cdn.example/plugin@2.js')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cdn.example/plugin@2.js')
  })

  it('rejects insecure remote sources before fetching', async () => {
    const plugin = usePluginInstall()

    expect(await plugin.install('http://cdn.example/plugin.js')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(plugin.validity.value).toContain('Plugin URLs must use HTTPS')
  })

  it('rejects HTTPS redirects to loopback while preserving explicit local development', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          text: async () => 'export default {}',
          url: 'http://127.0.0.1/plugin.js'
        })
      )
      .mockResolvedValueOnce(
        response({
          text: async () => 'export default {}',
          url: 'http://127.0.0.1/plugin.js'
        })
      )
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'LocalPlugin' })

    const plugin = usePluginInstall()
    expect(await plugin.install('https://cdn.example/plugin.js')).toBeNull()
    expect(plugin.validity.value).toContain('Plugin URLs must use HTTPS')

    expect(await plugin.install('http://127.0.0.1/plugin.js')).toMatchObject({
      pluginName: 'LocalPlugin',
      resolvedUrl: 'http://127.0.0.1/plugin.js'
    })
  })

  it('rejects HTML and oversized plugin responses before evaluation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          headers: { get: (name) => (name === 'content-type' ? 'text/html; charset=utf-8' : null) },
          text: async () => '<html></html>'
        })
      )
      .mockResolvedValueOnce(
        response({
          headers: {
            get: (name) => (name === 'content-length' ? String(MAX_PLUGIN_SOURCE_BYTES + 1) : null)
          },
          text: async () => 'not read'
        })
      )

    const plugin = usePluginInstall()
    expect(await plugin.install('https://cdn.example/html')).toBeNull()
    expect(plugin.validity.value).toContain('returned an HTML document')

    expect(await plugin.install('https://cdn.example/large.js')).toBeNull()
    expect(plugin.validity.value).toContain('exceeds the 512 KiB limit')
    expect(mocks.codegen).not.toHaveBeenCalled()
  })

  it('stops reading a streamed response once the plugin size limit is exceeded', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array(MAX_PLUGIN_SOURCE_BYTES + 1), { status: 200 })
    )

    const plugin = usePluginInstall()
    expect(await plugin.install('https://cdn.example/streamed-large.js')).toBeNull()
    expect(plugin.validity.value).toContain('exceeds the 512 KiB limit')
    expect(mocks.codegen).not.toHaveBeenCalled()
  })

  it('falls back to the bundled registry when live registry data is malformed', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ text: async () => '{bad json' }))
      .mockResolvedValueOnce(response({ text: async () => 'export default {}' }))
    mocks.codegen.mockResolvedValueOnce({ pluginName: 'SnapshotPlugin' })

    const plugin = usePluginInstall()
    const installed = await plugin.install('@snapshot-plugin')

    expect(installed?.resolvedUrl).toBe('https://snapshot/plugin.js')
  })
})
