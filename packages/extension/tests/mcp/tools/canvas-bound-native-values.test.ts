import type { CanvasFigmaProperties, CanvasResolvedApplyParameters } from '@tempad-dev/shared'

import { TEMPAD_MCP_ERROR_CODES } from '@tempad-dev/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyResolvedCanvas as applyCanvas } from '@/mcp/tools/canvas'
import {
  effectsEqual,
  layoutGridsEqual,
  paintStacksEqual
} from '@/mcp/tools/canvas/reconcile/native-values'

import { createFixture } from '../../fakes/figma'

const color: RGBA = { r: 1, g: 0, b: 0, a: 1 }
const resolvedColor: RGBA = { r: 0, g: 0, b: 1, a: 0.5 }
const alias: VariableAlias = { type: 'VARIABLE_ALIAS', id: 'variable:color' }
const otherAlias: VariableAlias = { type: 'VARIABLE_ALIAS', id: 'variable:other' }

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function gradient(type: GradientPaint['type']): GradientPaint {
  return {
    type,
    gradientTransform: [
      [1, 0, 0],
      [0, 1, 0]
    ],
    opacity: 0.75,
    visible: true,
    blendMode: 'NORMAL',
    gradientStops: [
      { position: 0.25, color, boundVariables: { color: alias } },
      { position: 0.75, color }
    ]
  }
}

function shadow(
  type: DropShadowEffect['type'] | InnerShadowEffect['type']
): DropShadowEffect | InnerShadowEffect {
  return {
    type,
    color,
    radius: 3,
    spread: 2,
    offset: { x: 1, y: 2 },
    visible: true,
    blendMode: 'NORMAL',
    boundVariables: { color: alias, radius: alias, spread: alias, offsetX: alias }
  }
}

describe('bound native values', () => {
  it.each(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'] as const)(
    'accepts resolved %s stop colors while retaining exact bindings and paint geometry',
    (type) => {
      const expected = gradient(type)
      const current: GradientPaint = {
        ...expected,
        gradientStops: [
          { ...expected.gradientStops[0]!, color: resolvedColor },
          expected.gradientStops[1]!
        ]
      }
      expect(paintStacksEqual([current], [expected])).toBe(true)
      const changes: GradientPaint[] = [
        { ...current, opacity: 0.5 },
        { ...current, visible: false },
        { ...current, blendMode: 'MULTIPLY' },
        {
          ...current,
          gradientTransform: [
            [1, 0, 0.2],
            [0, 1, 0]
          ]
        },
        {
          ...current,
          gradientStops: [{ ...current.gradientStops[0]!, position: 0 }, current.gradientStops[1]!]
        },
        {
          ...current,
          gradientStops: [
            current.gradientStops[0]!,
            { ...current.gradientStops[1]!, color: resolvedColor }
          ]
        },
        { ...current, gradientStops: current.gradientStops.slice(0, 1) }
      ]
      for (const boundVariables of [undefined, { color: otherAlias }]) {
        changes.push({
          ...current,
          gradientStops: [
            { ...current.gradientStops[0]!, boundVariables },
            current.gradientStops[1]!
          ]
        })
      }
      changes.push({
        ...current,
        gradientStops: [
          current.gradientStops[0]!,
          { ...current.gradientStops[1]!, boundVariables: { color: alias } }
        ]
      })
      for (const changed of changes) expect(paintStacksEqual([changed], [expected])).toBe(false)
    }
  )

  it.each(['DROP_SHADOW', 'INNER_SHADOW'] as const)(
    'accepts resolved %s fields without hiding unbound offsets or paint state',
    (type) => {
      const expected = shadow(type)
      const current = {
        ...expected,
        color: resolvedColor,
        radius: 24,
        spread: 12,
        offset: { x: 8, y: 2 }
      }
      expect(effectsEqual([current], [expected])).toBe(true)
      for (const changed of [
        { ...current, offset: { x: 8, y: 3 } },
        { ...current, visible: false },
        { ...current, blendMode: 'MULTIPLY' as const },
        { ...current, boundVariables: undefined },
        { ...current, boundVariables: { ...current.boundVariables, radius: otherAlias } },
        { ...current, boundVariables: { ...current.boundVariables, offsetY: alias } }
      ])
        expect(effectsEqual([changed], [expected])).toBe(false)

      const vertical = { ...expected, boundVariables: { offsetY: alias } }
      expect(effectsEqual([{ ...vertical, offset: { x: 1, y: 8 } }], [vertical])).toBe(true)
      for (const changed of [
        { ...vertical, offset: { x: 2, y: 8 } },
        { ...vertical, color: resolvedColor },
        { ...vertical, radius: 24 },
        { ...vertical, spread: 12 }
      ])
        expect(effectsEqual([changed], [vertical])).toBe(false)
    }
  )

  it.each(['LAYER_BLUR', 'BACKGROUND_BLUR'] as const)(
    'accepts a resolved %s radius without masking other progressive blur fields',
    (type) => {
      const expected: BlurEffect = {
        type,
        blurType: 'PROGRESSIVE',
        radius: 3,
        startRadius: 1,
        startOffset: { x: 0, y: 0 },
        endOffset: { x: 1, y: 1 },
        visible: true,
        boundVariables: { radius: alias }
      }
      const current = { ...expected, radius: 24 }
      expect(effectsEqual([current], [expected])).toBe(true)
      for (const changed of [
        { ...current, startRadius: 2 },
        { ...current, endOffset: { x: 0, y: 1 } },
        { ...current, visible: false },
        { ...current, boundVariables: undefined },
        { ...current, boundVariables: { radius: otherAlias } }
      ])
        expect(effectsEqual([changed], [expected])).toBe(false)
    }
  )

  it.each(['GRID', 'ROWS', 'COLUMNS'] as const)(
    'accepts resolved %s grid values while retaining geometry and aliases',
    (pattern) => {
      const expected: LayoutGrid =
        pattern === 'GRID'
          ? {
              pattern,
              sectionSize: 8,
              visible: true,
              color,
              boundVariables: { sectionSize: alias }
            }
          : {
              pattern,
              alignment: 'MIN',
              sectionSize: 8,
              count: 3,
              gutterSize: 4,
              offset: 2,
              visible: true,
              color,
              boundVariables: { sectionSize: alias, count: alias, gutterSize: alias, offset: alias }
            }
      const current: LayoutGrid =
        expected.pattern === 'GRID'
          ? { ...expected, sectionSize: 24 }
          : { ...expected, sectionSize: 24, count: 6, gutterSize: 12, offset: 8 }
      expect(layoutGridsEqual([current], [expected])).toBe(true)
      const changes: LayoutGrid[] = [
        current.pattern === 'GRID'
          ? { ...current, pattern: 'ROWS', alignment: 'MIN', count: 3, gutterSize: 4 }
          : { ...current, pattern: 'GRID', sectionSize: 24 },
        { ...current, visible: false },
        { ...current, color: resolvedColor },
        { ...current, boundVariables: undefined },
        { ...current, boundVariables: { ...current.boundVariables, sectionSize: otherAlias } }
      ]
      if (current.pattern !== 'GRID' && expected.pattern !== 'GRID') {
        changes.push({ ...current, alignment: 'MAX' })
        for (const field of ['sectionSize', 'count', 'gutterSize', 'offset'] as const) {
          const bindings = { ...expected.boundVariables }
          delete bindings[field]
          expect(
            layoutGridsEqual(
              [{ ...current, boundVariables: bindings }],
              [{ ...expected, boundVariables: bindings }]
            )
          ).toBe(false)
        }
      }
      for (const changed of changes) expect(layoutGridsEqual([changed], [expected])).toBe(false)
    }
  )
})

type NativeProperty = 'fills' | 'strokes' | 'effects' | 'layoutGrids'

function nativeProperties(property: NativeProperty): CanvasFigmaProperties {
  if (property === 'fills' || property === 'strokes')
    return {
      [property]: [
        {
          type: 'GRADIENT_RADIAL',
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0]
          ],
          gradientStops: [
            { position: 0, color, variables: { color: { variableKey: 'color' } } },
            { position: 1, color }
          ]
        }
      ]
    }
  if (property === 'effects')
    return {
      effects: [
        {
          type: 'DROP_SHADOW',
          color,
          radius: 3,
          offset: { x: 1, y: 2 },
          variables: { color: { variableKey: 'color' }, radius: { variableKey: 'size' } }
        }
      ]
    }
  return {
    layoutGrids: [
      { pattern: 'GRID', sectionSize: 8, variables: { sectionSize: { variableKey: 'size' } } }
    ]
  }
}

function resourceSpec(): NonNullable<CanvasResolvedApplyParameters['variableCollections']> {
  return {
    tokens: {
      name: 'Tokens',
      modes: { base: { name: 'Base' } },
      variables: {
        color: { name: 'Color', type: 'COLOR', values: { base: resolvedColor } },
        size: { name: 'Size', type: 'FLOAT', values: { base: 24 } }
      }
    }
  }
}

// This accessor models the captured native readback, without expanding the shared fake.
function normalizeBoundStack(
  property: NativeProperty,
  values: unknown,
  loseBinding = false
): unknown {
  if (property === 'fills' || property === 'strokes')
    return (values as Paint[]).map((paint) =>
      'gradientStops' in paint
        ? {
            ...paint,
            gradientStops: paint.gradientStops.map((stop) =>
              stop.boundVariables?.color
                ? {
                    ...stop,
                    color: resolvedColor,
                    boundVariables: loseBinding ? undefined : stop.boundVariables
                  }
                : stop
            )
          }
        : paint
    )
  if (property === 'effects')
    return (values as Effect[]).map((effect) =>
      effect.type === 'DROP_SHADOW'
        ? {
            ...effect,
            color: resolvedColor,
            radius: 24,
            boundVariables: loseBinding ? undefined : effect.boundVariables
          }
        : effect
    )
  return (values as LayoutGrid[]).map((grid) => ({
    ...grid,
    sectionSize: 24,
    boundVariables: loseBinding ? undefined : grid.boundVariables
  }))
}

describe('native bound-value reconciliation', () => {
  it.each(['fills', 'strokes', 'effects', 'layoutGrids'] as const)(
    'converges resolved direct %s but rejects a lost binding',
    async (property) => {
      const fixture = createFixture()
      let loseBinding = false
      vi.mocked(figma.createFrame).mockImplementationOnce(() => {
        const node = fixture.createNode('FRAME') as unknown as FrameNode
        let value: unknown = node[property]
        Object.defineProperty(node, property, {
          configurable: true,
          get: () => value,
          set: (next: unknown) => {
            value = normalizeBoundStack(property, next, loseBinding)
          }
        })
        return node
      })
      const spec: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup: '<div data-key="root" class="w-40 h-40"></div>',
        variableCollections: resourceSpec(),
        bindings: { root: { figma: nativeProperties(property) } }
      }
      const created = await applyCanvas(spec)
      const root = fixture.getNode(created.rootNodeId!) as unknown as FrameNode
      const update = { ...spec, mode: 'update' as const, targetNodeId: created.rootNodeId! }
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })

      // Remove native state so the next request must exercise the setter again.
      loseBinding = true
      root[property] = []
      await expect(applyCanvas(update)).rejects.toMatchObject({
        code: TEMPAD_MCP_ERROR_CODES.CANVAS_APPLY_FAILED,
        message: expect.stringContaining('Verification failed')
      })
    }
  )

  it.each(['PAINT', 'EFFECT', 'GRID'] as const)(
    'converges resolved values in authored %s styles',
    async (type) => {
      createFixture()
      const property: NativeProperty =
        type === 'PAINT' ? 'fills' : type === 'EFFECT' ? 'effects' : 'layoutGrids'
      const field = type === 'PAINT' ? 'paints' : property
      function normalizeStyle<T extends BaseStyle>(factory: () => T): void {
        const original = vi.mocked(factory).getMockImplementation()!
        vi.mocked(factory).mockImplementation(() => {
          const style = original()
          let value: unknown = []
          Object.defineProperty(style, field, {
            configurable: true,
            get: () => value,
            set: (next: unknown) => {
              value = normalizeBoundStack(property, next)
            }
          })
          return style
        })
      }
      if (type === 'PAINT') normalizeStyle(figma.createPaintStyle)
      else if (type === 'EFFECT') normalizeStyle(figma.createEffectStyle)
      else normalizeStyle(figma.createGridStyle)
      const native = nativeProperties(property)
      const spec: CanvasResolvedApplyParameters = {
        mode: 'create',
        markup: '<div data-key="root" class="w-40 h-40"></div>',
        variableCollections: resourceSpec(),
        styles: {
          authored:
            type === 'PAINT'
              ? { type, name: 'Bound paint', paints: native.fills }
              : type === 'EFFECT'
                ? { type, name: 'Bound effect', effects: native.effects }
                : { type, name: 'Bound grid', layoutGrids: native.layoutGrids }
        }
      }
      const created = await applyCanvas(spec)
      const update = { ...spec, mode: 'update' as const, targetNodeId: created.rootNodeId! }
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
      await expect(applyCanvas(update)).resolves.toMatchObject({ mutationCount: 0 })
    }
  )
})
