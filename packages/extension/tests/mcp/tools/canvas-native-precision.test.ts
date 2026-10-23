import type { CanvasFigmaProperties, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { expect, it, vi } from 'vitest'

import { applyResolvedCanvas } from '@/mcp/tools/canvas'
import { nativeValueEqual } from '@/mcp/tools/canvas/reconcile/comparison'
import { layoutGridsEqual, paintStacksEqual } from '@/mcp/tools/canvas/reconcile/native-values'

import { createFixture } from '../../fakes/figma'

function rounded(value: unknown): unknown {
  if (typeof value === 'number') return Math.fround(value)
  if (Array.isArray(value)) return value.map(rounded)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]))
  return value
}

function roundProperty(node: object, field: string): void {
  let value: unknown = Reflect.get(node, field)
  Object.defineProperty(node, field, {
    configurable: true,
    get: () => value,
    set: (next: unknown) => {
      value = rounded(next)
    }
  })
}

const cases = [
  ['fills', (value: number) => [{ type: 'SOLID', color: { r: value, g: 0, b: 0 } }]],
  ['strokes', (value: number) => [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, opacity: value }]],
  ['effects', (value: number) => [{ type: 'LAYER_BLUR', radius: value }]],
  ['layoutGrids', (value: number) => [{ pattern: 'GRID', sectionSize: value }]]
] as const

it.each(cases)(
  'preserves small %s edits and converges native float32 readback',
  async (field, stack) => {
    const fixture = createFixture()
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      const node = fixture.createNode('FRAME') as unknown as FrameNode
      roundProperty(node, field)
      return node
    })
    const request = (value: number): CanvasResolvedApplyParameters => ({
      mode: 'create',
      markup: '<div data-key="root" class="w-40 h-40"/>',
      bindings: {
        root: {
          figma: {
            [field]: stack(value),
            ...(field === 'strokes' ? { stroke: { weight: 1 } } : {})
          } as CanvasFigmaProperties
        }
      }
    })
    const created = await applyResolvedCanvas(request(0.3))
    const update = (value: number) =>
      applyResolvedCanvas({ ...request(value), mode: 'update', targetNodeId: created.rootNodeId! })
    await expect(update(0.3)).resolves.toMatchObject({ mutationCount: 0 })
    await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 1 })
    expect((fixture.getNode(created.rootNodeId!) as unknown as FrameNode)[field]).toMatchObject(
      rounded(stack(0.301)) as object[]
    )
    await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 0 })
  }
)

it.each(['guides', 'dashPattern', 'page guides'] as const)(
  'converges float32 %s while preserving edits, ordering and clearing',
  async (field) => {
    const fixture = createFixture()
    const property = field === 'dashPattern' ? 'dashPattern' : 'guides'
    if (field === 'page guides') roundProperty(fixture.page, property)
    else {
      vi.mocked(figma.createFrame).mockImplementationOnce(() => {
        const node = fixture.createNode('FRAME') as unknown as FrameNode
        roundProperty(node, property)
        return node
      })
    }
    const guides = (offsets: number[]): Guide[] => offsets.map((offset) => ({ axis: 'X', offset }))
    const request = (offsets: number[]): CanvasResolvedApplyParameters => ({
      mode: 'create',
      markup: '<div data-key="root" class="w-40 h-40"/>',
      ...(field === 'page guides'
        ? { page: { guides: guides(offsets) } }
        : {
            bindings: {
              root: {
                figma:
                  field === 'dashPattern'
                    ? { stroke: { dashPattern: offsets } }
                    : { guides: guides(offsets) }
              }
            }
          })
    })
    const created = await applyResolvedCanvas(request([0.3, 0.7]))
    const node = field === 'page guides' ? fixture.page : fixture.getNode(created.rootNodeId!)
    const update = (offsets: number[]) =>
      applyResolvedCanvas({
        ...request(offsets),
        mode: 'update',
        targetNodeId: created.rootNodeId!
      })
    await expect(update([0.3, 0.7])).resolves.toMatchObject({ mutationCount: 0 })
    for (const offsets of [[0.301, 0.7], [0.7, 0.301], []]) {
      await expect(update(offsets)).resolves.toMatchObject({ mutationCount: 1 })
      expect(Reflect.get(node, property)).toEqual(
        rounded(field === 'dashPattern' ? offsets : guides(offsets))
      )
      await expect(update(offsets)).resolves.toMatchObject({ mutationCount: 0 })
    }
  }
)

it.each(
  (['gridColumnSizes', 'gridRowSizes'] as const).flatMap((field) =>
    (['px', 'fr'] as const).map((unit) => ({ field, unit }))
  )
)('converges float32 $field $unit tracks while retaining small edits', async ({ field, unit }) => {
  const fixture = createFixture()
  vi.mocked(figma.createFrame).mockImplementationOnce(() => {
    const node = fixture.createNode('FRAME') as unknown as FrameNode
    roundProperty(node[field][0]!, 'value')
    return node
  })
  const request = (value: number): CanvasResolvedApplyParameters => ({
    mode: 'create',
    markup: `<div data-key="grid" class="grid grid-cols-[${field === 'gridColumnSizes' ? `${value}${unit}` : '1fr'}] grid-rows-[${field === 'gridRowSizes' ? `${value}${unit}` : '1fr'}] w-40 h-40"/>`
  })
  const created = await applyResolvedCanvas(request(0.3))
  const node = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
  const update = (value: number) =>
    applyResolvedCanvas({ ...request(value), mode: 'update', targetNodeId: node.id })

  await expect(update(0.3)).resolves.toMatchObject({ mutationCount: 0 })
  await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 1 })
  expect(node[field][0]).toEqual({
    type: unit === 'px' ? 'FIXED' : 'FLEX',
    value: Math.fround(0.301)
  })
  await expect(update(0.301)).resolves.toMatchObject({ mutationCount: 0 })
})

it.each([
  { axis: 'Y', offset: Math.fround(0.3) },
  { axis: 'X', offset: Math.fround(0.301) }
] as const)('rejects mismatched guide readback $axis/$offset', async (guide) => {
  const fixture = createFixture()
  vi.mocked(figma.createFrame).mockImplementationOnce(() => {
    const node = fixture.createNode('FRAME') as unknown as FrameNode
    Object.defineProperty(node, 'guides', {
      configurable: true,
      get: () => [guide],
      set: () => {}
    })
    return node
  })
  await expect(
    applyResolvedCanvas({
      mode: 'create',
      markup: '<div data-key="root" class="w-40 h-40"/>',
      bindings: { root: { figma: { guides: [{ axis: 'X', offset: 0.3 }] } } }
    })
  ).rejects.toThrow('guides do not match')
})

it('compares own record keys even when their values are undefined', () => {
  expect(nativeValueEqual({ first: undefined }, { second: undefined })).toBe(false)
  expect(nativeValueEqual({ first: undefined }, { first: undefined })).toBe(true)
  expect(nativeValueEqual({ boundVariables: {}, properties: {} }, {})).toBe(true)
})

it('accepts the rounded grid color but rejects a neighboring byte channel', () => {
  const grid: LayoutGrid = {
    pattern: 'GRID',
    sectionSize: 8,
    color: { r: 0.043, g: 0, b: 0, a: 1 }
  }
  const stored = { ...grid, color: { ...grid.color!, r: Math.round(0.043 * 255) / 255 } }
  expect(layoutGridsEqual([stored], [grid])).toBe(true)
  expect(layoutGridsEqual([{ ...stored, color: { ...stored.color, r: 10 / 255 } }], [grid])).toBe(
    false
  )
})

it('preserves gradient position and transform edits below the former color tolerance', () => {
  const gradient: GradientPaint = {
    type: 'GRADIENT_LINEAR',
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    gradientStops: [{ position: 0.3, color: { r: 1, g: 0, b: 0, a: 1 } }]
  }
  expect(paintStacksEqual([rounded(gradient) as GradientPaint], [gradient])).toBe(true)
  expect(
    paintStacksEqual(
      [gradient],
      [{ ...gradient, gradientStops: [{ ...gradient.gradientStops[0]!, position: 0.301 }] }]
    )
  ).toBe(false)
  expect(
    paintStacksEqual(
      [gradient],
      [
        {
          ...gradient,
          gradientTransform: [
            [1, 0, 0.001],
            [0, 1, 0]
          ]
        }
      ]
    )
  ).toBe(false)
})

it('writes a small vector vertex edit and then converges', async () => {
  const fixture = createFixture()
  const request = (x: number): CanvasResolvedApplyParameters => ({
    mode: 'create',
    markup:
      '<div data-key="root" class="flex w-40 h-40"><div data-key="vector" class="w-10 h-10"/></div>',
    bindings: {
      vector: {
        figma: {
          shape: {
            type: 'VECTOR',
            network: {
              vertices: [
                { x, y: 0 },
                { x: 10, y: 10 }
              ],
              segments: [{ start: 0, end: 1 }]
            }
          }
        }
      }
    }
  })
  const created = await applyResolvedCanvas(request(0.3))
  const update = { ...request(0.301), mode: 'update' as const, targetNodeId: created.rootNodeId! }
  const vector = fixture.getNode(created.nodeIdsByKey.vector!) as unknown as VectorNode
  vi.mocked(vector.setVectorNetworkAsync).mockClear()
  await applyResolvedCanvas(update)
  expect(vector.setVectorNetworkAsync).toHaveBeenCalledOnce()
  expect(
    (fixture.getNode(created.nodeIdsByKey.vector!) as unknown as VectorNode).vectorNetwork
      .vertices[0]?.x
  ).toBe(0.301)
  await expect(applyResolvedCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
})
