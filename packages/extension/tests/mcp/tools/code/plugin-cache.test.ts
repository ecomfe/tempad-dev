import { afterEach, expect, it, vi } from 'vitest'

import type { CodegenBatchRequestPayload, RequestPayload, ResponsePayload } from '@/types/codegen'

import { handleGetCode } from '@/mcp/tools/code'
import { createGetCodeCacheContext } from '@/mcp/tools/code/cache'

const sandbox = vi.hoisted(() => vi.fn())

vi.mock('@/plugin-sandbox/requester', () => ({ requestPluginSandbox: sandbox }))
vi.mock('@/ui/state', () => ({
  activePlugin: { value: { name: 'test-plugin', code: 'test-plugin-code' } },
  options: { value: { cssUnit: 'px', rootFontSize: 16, scale: 1 } }
}))

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

function fixture(component: boolean) {
  vi.stubGlobal('__DEV__', false)
  vi.stubGlobal('figma', {
    mixed: Symbol('mixed'),
    variables: { getVariableById: () => null, getVariableCollectionById: () => null },
    getStyleById: () => null
  })
  const response = (): ResponsePayload => ({
    codeBlocks: [],
    ...(component ? { devComponent: { name: 'Button', props: {}, children: [] } } : {})
  })
  sandbox.mockImplementation(
    async (_worker: string, payload: CodegenBatchRequestPayload | RequestPayload) =>
      'jobs' in payload ? { results: payload.jobs.map(response) } : response()
  )
  const node = (id: string, type: SceneNode['type'], children: SceneNode[] = []): SceneNode =>
    ({
      id,
      type,
      name: id,
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      relativeTransform: [
        [1, 0, 0],
        [0, 1, 0]
      ],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 40 },
      layoutMode: 'HORIZONTAL',
      children,
      fills: [],
      strokes: [],
      effects: [],
      ...(type === 'INSTANCE' ? { componentProperties: {}, mainComponent: null } : {}),
      getCSSAsync: vi.fn(async () => ({ width: '100px', height: '40px' }))
    }) as unknown as SceneNode
  return { node, response }
}

it.each([false, true])(
  'shares one CSS read between plugin preparation and MCP collection (component: %s)',
  async (component) => {
    const { node } = fixture(component)
    const instance = node('instance', 'INSTANCE')

    const result = await handleGetCode([instance])

    expect(result.code).toContain(component ? '<Button' : '<div')
    expect(instance.getCSSAsync).toHaveBeenCalledOnce()
    expect(sandbox).toHaveBeenCalledOnce()
  }
)

it.each([false, true])(
  'reuses plugin results across overlapping roots only within the request (component: %s)',
  async (component) => {
    const { node } = fixture(component)
    const instance = node('instance', 'INSTANCE')
    const parent = node('parent', 'FRAME', [instance])
    const cache = createGetCodeCacheContext()

    await handleGetCode([parent], 'jsx', false, 'smart', { cache })
    const result = await handleGetCode([instance], 'jsx', false, 'smart', { cache })

    expect(result.code).toContain(component ? '<Button' : '<div')
    expect(sandbox).toHaveBeenCalledOnce()
    expect(instance.getCSSAsync).toHaveBeenCalledOnce()
    await handleGetCode([instance], 'jsx', false)
    expect(sandbox).toHaveBeenCalledTimes(2)
    expect(instance.getCSSAsync).toHaveBeenCalledTimes(2)
  }
)

it('reuses a completed empty plugin result when an instance falls back to a shell', async () => {
  vi.useFakeTimers()
  const { node } = fixture(false)
  const child = node('slow', 'FRAME')
  const css = Promise.withResolvers<Record<string, string>>()
  vi.mocked(child.getCSSAsync).mockReturnValue(css.promise)
  const instance = node('instance', 'INSTANCE', [child])
  const pending = handleGetCode([instance])

  await vi.advanceTimersByTimeAsync(20_000)
  const result = await pending

  expect(result.warnings?.some(({ type }) => type === 'shell')).toBe(true)
  expect(sandbox).toHaveBeenCalledOnce()
  expect(instance.getCSSAsync).toHaveBeenCalledOnce()
  css.resolve({ width: '100px', height: '40px' })
  await vi.runAllTimersAsync()
  expect(vi.getTimerCount()).toBe(0)
})
