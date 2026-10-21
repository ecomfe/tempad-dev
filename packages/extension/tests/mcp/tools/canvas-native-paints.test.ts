import type { CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { afterEach, expect, it, vi } from 'vitest'

import { applyResolvedCanvas } from '@/mcp/tools/canvas'
import { paintStacksEqual } from '@/mcp/tools/canvas/reconcile/native-values'

import { createFixture } from '../../fakes/figma'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const boundSolid: SolidPaint = {
  type: 'SOLID',
  color: { r: 1, g: 0, b: 0 },
  opacity: 1,
  boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'variable:color' } }
}

it.each([
  { alpha: 0.5, opacity: undefined },
  { alpha: 1, opacity: 0.5 },
  { alpha: 0.5, opacity: 0.5 }
])(
  'reconciles bound SOLID readback alpha $alpha with authored opacity $opacity',
  async ({ alpha, opacity }) => {
    const fixture = createFixture()
    vi.mocked(figma.createFrame).mockImplementationOnce(() => {
      const node = fixture.createNode('FRAME')
      const descriptor = Object.getOwnPropertyDescriptor(node, 'fills')!
      Object.defineProperty(node, 'fills', {
        configurable: true,
        get: descriptor.get,
        set(value: readonly Paint[]) {
          descriptor.set!.call(
            node,
            value.map((paint) =>
              paint.type === 'SOLID' && paint.boundVariables?.color
                ? { ...paint, color: { r: 0, g: 1, b: 0 }, opacity: alpha }
                : paint
            )
          )
        }
      })
      return node as unknown as FrameNode
    })
    const input: CanvasResolvedApplyParameters = {
      mode: 'create',
      markup: '<div data-key="root" class="w-40 h-40"></div>',
      bindings: {
        root: {
          figma: {
            fills: [
              {
                type: 'SOLID',
                color: { r: 1, g: 0, b: 0 },
                ...(opacity === undefined ? {} : { opacity }),
                variables: { color: { key: 'color-key' } }
              }
            ]
          }
        }
      }
    }

    const created = await applyResolvedCanvas(input)
    expect(fixture.getNode(created.rootNodeId!).fills).toEqual([
      expect.objectContaining({
        color: { r: 0, g: 1, b: 0 },
        opacity: alpha,
        boundVariables: boundSolid.boundVariables
      })
    ])
    await expect(
      applyResolvedCanvas({ ...input, mode: 'update', targetNodeId: created.rootNodeId! })
    ).resolves.toMatchObject({ mutationCount: 0 })
  }
)

it.each([
  ['missing binding', { boundVariables: undefined }],
  ['different binding', { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'other' } } }],
  ['visibility', { visible: false }],
  ['blend mode', { blendMode: 'MULTIPLY' }]
] as const)('rejects a bound SOLID difference in %s', (_, fields) => {
  expect(paintStacksEqual([{ ...boundSolid, ...fields }], [boundSolid])).toBe(false)
})

it('retains strict color and opacity comparison for unbound SOLID paints', () => {
  const unbound: SolidPaint = { type: 'SOLID', color: boundSolid.color, opacity: 1 }
  expect(paintStacksEqual([{ ...unbound, color: { r: 0, g: 1, b: 0 } }], [unbound])).toBe(false)
  expect(paintStacksEqual([{ ...unbound, opacity: 0.5 }], [unbound])).toBe(false)
  expect(paintStacksEqual([boundSolid], [unbound])).toBe(false)
})
