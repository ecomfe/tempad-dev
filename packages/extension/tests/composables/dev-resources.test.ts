import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, shallowRef } from 'vue'

vi.mock('@/ui/state', async () => {
  const { shallowRef } = await import('vue')
  return {
    selection: shallowRef<readonly SceneNode[]>([]),
    layoutReady: shallowRef(false),
    runtimeMode: shallowRef('standard')
  }
})
vi.mock('@/utils', () => ({ getCanvas: () => null, getLeftPanel: () => null }))

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
  it('retains cached links when a reselect and explicit refresh share a failed read', async () => {
    const api = await importComposable()
    let reject!: (error: unknown) => void
    const pending = new Promise<DevResource[]>((_, fail) => (reject = fail))
    const read = vi
      .fn<() => Promise<DevResource[]>>()
      .mockResolvedValueOnce([{ name: 'Saved', url: '' }])
      .mockReturnValueOnce(pending)
    const node = createNode({ getDevResourcesAsync: read })
    const selected = shallowRef<SceneNode | null>(node)
    const scope = effectScope()
    try {
      const links = scope.run(() => api.useDevResourceLinks(selected))!
      await flushEffects()
      expect(links.value.map(({ name }) => name)).toEqual(['Saved'])
      selected.value = null
      await flushEffects()
      selected.value = node
      await flushEffects()
      const explicit = api.refreshDevResourceLinks(node)
      const failure = expect(explicit).rejects.toBe('request failed: status 403')
      reject('request failed: status 403')
      await failure
      await flushEffects()
      expect(read).toHaveBeenCalledTimes(2)
      expect(links.value.map(({ name }) => name)).toEqual(['Saved'])
    } finally {
      scope.stop()
    }
  })

  it('explicitly refreshes a selected node and shares the current request', async () => {
    const api = await importComposable()
    let resolve!: (resources: DevResource[]) => void
    const pending = new Promise<DevResource[]>((done) => (resolve = done))
    const read = vi.fn(() => pending)
    const node = createNode({ getDevResourcesAsync: read })
    const scope = effectScope()
    try {
      const links = scope.run(() => api.useDevResourceLinks(shallowRef(node)))!
      const first = api.refreshDevResourceLinks(node)
      const second = api.refreshDevResourceLinks(node)
      expect(first).toBe(second)
      await flushEffects()
      expect(read).toHaveBeenCalledOnce()
      resolve([{ name: 'Refreshed', url: '' }])
      await first
      expect(links.value.map(({ name }) => name)).toEqual(['Refreshed'])
    } finally {
      scope.stop()
    }
  })

  it.each([new Error('Temporary API failure'), 'request failed: status 403'])(
    'retries a synchronous resource failure after reselecting the node: %s',
    async (error) => {
      const getDevResourcesAsync = vi
        .fn<() => Promise<DevResource[]>>()
        .mockImplementationOnce(() => {
          throw error
        })
        .mockResolvedValue([{ name: 'Recovered', url: '' }])
      const node = createNode({ getDevResourcesAsync })
      const selected = shallowRef<SceneNode | null>(node)
      const { useDevResourceLinks } = await importComposable()
      const scope = effectScope()
      try {
        const links = scope.run(() => useDevResourceLinks(selected))!
        await flushEffects()
        expect(getDevResourcesAsync).toHaveBeenCalledOnce()
        expect(links.value).toEqual([])
        selected.value = null
        await flushEffects()
        selected.value = node
        await flushEffects()
        expect(getDevResourcesAsync).toHaveBeenCalledTimes(2)
        expect(links.value.map(({ name }) => name)).toEqual(['Recovered'])
      } finally {
        scope.stop()
      }
    }
  )

  it('shares a pending resource read and refreshes it after reselecting the same node', async () => {
    let resolve!: (resources: DevResource[]) => void
    const pending = new Promise<DevResource[]>((done) => (resolve = done))
    const getDevResourcesAsync = vi
      .fn<() => Promise<DevResource[]>>()
      .mockReturnValueOnce(pending)
      .mockResolvedValue([{ name: 'Updated', url: '' }])
    const node = createNode({ getDevResourcesAsync })
    const selected = shallowRef<SceneNode | null>(node)
    const { useDevResourceLinks } = await importComposable()
    const scope = effectScope()
    try {
      const first = scope.run(() => useDevResourceLinks(selected))!
      const second = scope.run(() => useDevResourceLinks(selected))!
      await flushEffects()
      expect(getDevResourcesAsync).toHaveBeenCalledOnce()
      expect(first.value).toEqual([])
      expect(second.value).toEqual([])
      resolve([{ name: 'Original', url: '' }])
      await flushEffects()
      expect(first.value.map(({ name }) => name)).toEqual(['Original'])
      expect(second.value).toEqual(first.value)
      selected.value = null
      await flushEffects()
      expect(first.value).toEqual([])
      selected.value = node
      await flushEffects()
      expect(getDevResourcesAsync).toHaveBeenCalledTimes(2)
      expect(first.value.map(({ name }) => name)).toEqual(['Updated'])
      expect(second.value).toEqual(first.value)
    } finally {
      scope.stop()
    }
  })

  it.each(['api', 'url'] as const)(
    'refreshes resources for identical node IDs after a document switch using %s identity',
    async (identity) => {
      const { useDevResourceLinks } = await importComposable()
      const { syncSelection } = await import('@/composables/selection')
      const { selection } = await import('@/ui/state')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false }))
      )
      const nodeForFile = (file: string) =>
        createNode({
          getDevResourcesAsync: vi.fn(async () => [
            { name: file, url: `https://example.com/${file}` }
          ])
        })
      const a = nodeForFile('file-a')
      const b = nodeForFile('file-b')
      const api = {
        fileKey: identity === 'api' ? 'file-a' : undefined,
        currentPage: { selection: [a] }
      }
      vi.stubGlobal('window', { figma: api })
      vi.stubGlobal('figma', api)
      vi.stubGlobal('location', new URL('https://www.figma.com/design/file-a/Design'))
      const scope = effectScope()
      const links = scope.run(() =>
        useDevResourceLinks(computed(() => selection.value[0] ?? null))
      )!
      try {
        syncSelection()
        await flushEffects()
        expect(links.value.map(({ name }) => name)).toEqual(['file-a'])
        api.fileKey = identity === 'api' ? 'file-b' : undefined
        api.currentPage.selection = [b]
        vi.stubGlobal('location', new URL('https://www.figma.com/design/file-b/Design'))
        syncSelection()
        await flushEffects()
        expect(selection.value[0]).toBe(b)
        expect(links.value.map(({ name }) => name)).toEqual(['file-b'])
        expect(a.getDevResourcesAsync).toHaveBeenCalledOnce()
        expect(b.getDevResourcesAsync).toHaveBeenCalledOnce()
      } finally {
        scope.stop()
      }
    }
  )

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

  it.each([
    {
      type: 'COMPONENT_SET',
      own: ['https://set.example.com'],
      expected: ['https://set.example.com']
    },
    { type: 'COMPONENT_SET', own: [], expected: [] },
    {
      type: 'COMPONENT',
      own: ['https://component.example.com'],
      expected: ['https://component.example.com']
    }
  ])('uses the selected $type documentation links: $own', async ({ type, own, expected }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false }))
    )
    const node = createNode({
      type,
      documentationLinks: own.map((uri) => ({ uri })),
      parent:
        type === 'COMPONENT'
          ? {
              type: 'COMPONENT_SET',
              documentationLinks: [{ uri: 'https://parent.example.com' }]
            }
          : null
    })
    const { useDevResourceLinks } = await importComposable()
    const scope = effectScope()
    try {
      const links = scope.run(() => useDevResourceLinks(ref(node)))!
      await flushEffects()
      expect(links.value).toEqual(
        expected.map((url) => ({
          name: 'Documentation',
          url,
          favicon: null,
          inherited: false
        }))
      )
    } finally {
      scope.stop()
    }
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

  it('cancels an HTTP error favicon body and caches null even when cancellation rejects', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('Cleanup failed')
    })
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetchMock = vi.fn(async () => new Response(body, { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const node = createNode({
      getDevResourcesAsync: vi.fn(async () => [{ name: 'Docs', url: 'https://docs.example.com' }])
    })
    const { useDevResourceLinks } = await importComposable()
    const scope = effectScope()
    try {
      const links = scope.run(() => useDevResourceLinks(ref(node)))!
      await flushEffects()
      expect(cancel).toHaveBeenCalledOnce()
      expect(body.locked).toBe(false)
      expect(links.value).toEqual([
        {
          name: 'Docs',
          url: 'https://docs.example.com',
          favicon: null,
          inherited: false
        }
      ])
      await flushEffects()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      scope.stop()
    }
  })
})
