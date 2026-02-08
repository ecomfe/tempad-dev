import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

function installBtoa() {
  if (typeof globalThis.btoa === 'function') {
    return
  }
  vi.stubGlobal('btoa', (value: string) => Buffer.from(value, 'binary').toString('base64'))
}

async function flushEffects() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

type DevResource = {
  name: string
  url: string
  inheritedNodeId?: string
}

function createNode(overrides: Record<string, unknown> = {}): SceneNode {
  return {
    id: 'node-1',
    type: 'COMPONENT',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    name: 'Node',
    documentationLinks: [] as DocumentationLink[],
    getDevResourcesAsync: vi.fn(async () => [] as DevResource[]),
    ...overrides
  } as unknown as SceneNode
}

async function importComposable() {
  vi.resetModules()
  return import('@/composables/dev-resources')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('composables/dev-resources', () => {
  it('combines documentation/resources, sorts inheritance and resolves favicons', async () => {
    installBtoa()

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        meta: [url.length % 255, 65]
      })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const mainComponent = {
      type: 'COMPONENT',
      documentationLinks: [{ uri: 'https://docs.example.com' }],
      parent: null
    } as unknown as ComponentNode

    const node = createNode({
      id: 'instance-1',
      type: 'INSTANCE',
      mainComponent,
      getDevResourcesAsync: vi.fn(
        async () =>
          [
            { name: 'Second', url: 'https://resource.example.com/second' },
            {
              name: 'First',
              url: 'https://resource.example.com/first',
              inheritedNodeId: 'parent-1'
            }
          ] as DevResource[]
      )
    })

    const { useDevResourceLinks } = await importComposable()

    const links = useDevResourceLinks(ref(node))
    await flushEffects()

    expect(links.value.map((item) => item.name)).toEqual(['Documentation', 'First', 'Second'])
    expect(links.value.map((item) => item.inherited)).toEqual([false, true, false])
    expect(
      links.value.every(
        (item) => item.favicon === null || item.favicon.startsWith('data:image/png;base64,')
      )
    ).toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://docs.example.com'))
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://resource.example.com/first'))
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent('https://resource.example.com/second'))
    )
  })

  it('falls back to empty resources on 403 errors', async () => {
    installBtoa()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )

    const getDevResourcesAsync = vi.fn(async () => {
      throw 'request failed: status 403'
    })

    const node = createNode({
      id: 'node-403',
      getDevResourcesAsync
    })

    const { useDevResourceLinks } = await importComposable()

    const links = useDevResourceLinks(ref(node))
    await flushEffects()

    expect(getDevResourcesAsync).toHaveBeenCalledTimes(1)
    expect(links.value).toEqual([])
  })

  it('uses component-set documentation links when component links are empty', async () => {
    installBtoa()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )

    const node = createNode({
      id: 'component-1',
      type: 'COMPONENT',
      documentationLinks: [],
      parent: {
        type: 'COMPONENT_SET',
        documentationLinks: [{ uri: 'https://set-docs.example.com' }]
      },
      getDevResourcesAsync: vi.fn(async () => [] as DevResource[])
    })

    const { useDevResourceLinks } = await importComposable()

    const links = useDevResourceLinks(ref(node))
    await flushEffects()

    expect(links.value).toEqual([
      {
        name: 'Documentation',
        url: 'https://set-docs.example.com',
        favicon: null,
        inherited: false
      }
    ])
  })

  it('caches favicon nulls after fetch failures to avoid duplicate requests', async () => {
    installBtoa()

    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)

    const node = createNode({
      id: 'node-favicon-error',
      getDevResourcesAsync: vi.fn(
        async () => [{ name: 'Only', url: 'https://favicon.example.com' }] as DevResource[]
      )
    })

    const { useDevResourceLinks } = await importComposable()

    const links = useDevResourceLinks(ref(node))
    await flushEffects()

    expect(links.value).toEqual([
      {
        name: 'Only',
        url: 'https://favicon.example.com',
        favicon: null,
        inherited: false
      }
    ])

    await flushEffects()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
