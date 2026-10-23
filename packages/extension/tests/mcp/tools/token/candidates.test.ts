import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { collectCandidateVariableIds } from '@/mcp/tools/token/candidates'
import { logger } from '@/utils/log'

vi.mock('@/utils/log', () => ({
  logger: {
    debug: vi.fn()
  }
}))

function createNode(input: Record<string, unknown>): SceneNode {
  return input as unknown as SceneNode
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  delete (globalThis as { figma?: PluginAPI }).figma
})

describe('token/candidates collectCandidateVariableIds', () => {
  it('collects gradient stop bindings from node fills and visible style paints', () => {
    const gradient = (id: string, visible = true) => ({
      type: 'GRADIENT_LINEAR',
      visible,
      gradientStops: [
        { boundVariables: { color: { type: 'VARIABLE_ALIAS', id } } },
        { color: { r: 0, g: 0, b: 0, a: 1 } }
      ]
    })
    const result = collectCandidateVariableIds(
      [
        createNode({
          id: 'root',
          visible: true,
          fills: [gradient('direct')],
          fillStyleId: 'style'
        })
      ],
      {
        getStyleById: () =>
          ({
            paints: [gradient('styled'), gradient('hidden', false)]
          }) as unknown as BaseStyle,
        getVariableById: () => null
      }
    )

    expect(result).toEqual(new Set(['direct', 'styled']))
  })

  it.each(['paints', 'boundVariables'])(
    'retains lookup recovery when a native style %s getter fails without a checkpoint',
    (field) => {
      const style = Object.defineProperty({ paints: [] }, field, {
        get() {
          throw new Error('Style is unavailable')
        }
      })
      const result = collectCandidateVariableIds(
        [createNode({ id: 'root', type: 'RECTANGLE', visible: true, fillStyleId: 'style' })],
        {
          getStyleById: () => style as unknown as BaseStyle,
          getVariableById: () => null
        }
      )
      expect(result).toEqual(new Set())
    }
  )

  it('collects candidate ids from node vars, paints, style paints and children', () => {
    const root = createNode({
      id: 'root',
      visible: true,
      fillStyleId: 'style-1',
      strokeStyleId: 'style-2',
      boundVariables: {
        color: { id: 'id-bound' },
        nested: [{ id: 'id-array' }]
      },
      fills: [
        {
          type: 'SOLID',
          visible: true,
          boundVariables: { color: { id: 'id-fill' } },
          variableReferences: { color: { id: 'id-fill-ref' } }
        },
        {
          type: 'SOLID',
          visible: false,
          boundVariables: { color: { id: 'id-fill-hidden' } }
        }
      ],
      strokes: [
        {
          type: 'SOLID',
          visible: true,
          boundVariables: { color: { id: 'id-stroke' } },
          variableReferences: { color: { id: 'id-stroke-ref' } }
        }
      ],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          boundVariables: { radius: { id: 'id-effect' } },
          variableReferences: { color: { id: 'id-effect-ref' } }
        }
      ],
      children: [
        createNode({
          id: 'child-visible',
          visible: true,
          boundVariables: { size: { id: 'id-child' } }
        }),
        createNode({
          id: 'child-hidden',
          visible: false,
          boundVariables: { size: { id: 'id-hidden-child' } }
        })
      ]
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      getStyleById: vi.fn((styleId: string) => {
        if (styleId === 'style-1') {
          return {
            paints: [
              {
                type: 'SOLID',
                visible: true,
                boundVariables: { color: { id: 'id-style-fill' } }
              },
              {
                type: 'SOLID',
                visible: false,
                boundVariables: { color: { id: 'id-style-hidden' } }
              }
            ]
          }
        }
        if (styleId === 'style-2') {
          return {
            paints: [
              {
                type: 'SOLID',
                visible: true,
                boundVariables: { color: { id: 'id-style-stroke' } }
              }
            ]
          }
        }
        return null
      })
    } as unknown as PluginAPI

    const result = collectCandidateVariableIds([root])

    expect(result).toEqual(
      new Set([
        'id-bound',
        'id-array',
        'id-fill',
        'id-fill-ref',
        'id-stroke',
        'id-stroke-ref',
        'id-effect',
        'id-effect-ref',
        'id-child',
        'id-style-fill',
        'id-style-stroke',
        'id-fill-hidden'
      ])
    )
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ids=12'))
  })

  it('reports each visible node’s ids while preserving the ordered union', () => {
    const onNodeVariableIds = vi.fn()
    const root = createNode({
      id: 'root',
      type: 'FRAME',
      visible: true,
      boundVariables: { width: { id: 'shared' } },
      children: [
        createNode({
          id: 'child',
          type: 'RECTANGLE',
          visible: true,
          boundVariables: { height: { id: 'shared' }, width: { id: 'child-only' } }
        }),
        createNode({ id: 'empty', type: 'RECTANGLE', visible: true }),
        createNode({
          id: 'hidden',
          type: 'RECTANGLE',
          visible: false,
          boundVariables: { width: { id: 'hidden-only' } }
        })
      ]
    })

    const result = collectCandidateVariableIds([root], undefined, {
      onNodeVariableIds
    })

    expect([...result]).toEqual(['shared', 'child-only'])
    expect(onNodeVariableIds.mock.calls).toEqual([
      ['root', new Set(['shared'])],
      ['child', new Set(['shared', 'child-only'])],
      ['empty', new Set()]
    ])

    onNodeVariableIds.mockClear()
    const capped = collectCandidateVariableIds([root], undefined, {
      captureNodeId: (id) => id !== 'child',
      onNodeVariableIds
    })
    expect(capped).toEqual(result)
    expect(onNodeVariableIds.mock.calls).toEqual([
      ['root', new Set(['shared'])],
      ['empty', new Set()]
    ])
  })

  it('skips invisible roots and tolerates style lookup failures', () => {
    const hiddenRoot = createNode({
      id: 'hidden-root',
      visible: false,
      boundVariables: { color: { id: 'id-hidden' } }
    })
    const styleErrorNode = createNode({
      id: 'style-error-node',
      visible: true,
      fillStyleId: 'style-error'
    })
    const nonStringStyleIdNode = createNode({
      id: 'non-string-style-id',
      visible: true,
      fillStyleId: 1
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      getStyleById: vi.fn(() => {
        throw new Error('style lookup failed')
      })
    } as unknown as PluginAPI

    const result = collectCandidateVariableIds([hiddenRoot, styleErrorNode, nonStringStyleIdNode])
    expect(result).toEqual(new Set())
  })

  it('can limit candidate scanning to the selected root', () => {
    const root = createNode({
      id: 'root',
      visible: true,
      boundVariables: { color: { id: 'id-root' } },
      children: [
        createNode({
          id: 'child',
          visible: true,
          boundVariables: { color: { id: 'id-child' } }
        })
      ]
    })

    const result = collectCandidateVariableIds([root], undefined, {
      traverseChildren: false
    })

    expect(result).toEqual(new Set(['id-root']))
  })

  it('falls back to Date.now when performance is unavailable', () => {
    const performanceOriginal = globalThis.performance
    vi.stubGlobal('performance', undefined)

    const root = createNode({
      id: 'root',
      visible: true,
      boundVariables: { color: { id: 'id-1' } }
    })
    const result = collectCandidateVariableIds([root])

    expect(result).toEqual(new Set(['id-1']))

    if (performanceOriginal) {
      vi.stubGlobal('performance', performanceOriginal)
    } else {
      delete (globalThis as { performance?: Performance }).performance
    }
  })

  it('collects text variable ids from whole-range bindings and text styles', () => {
    const root = createNode({
      id: 'text-root',
      type: 'TEXT',
      visible: true,
      characters: 'Hello',
      textStyleId: 'text-style-1',
      getRangeBoundVariable: vi.fn(
        (_start: number, _end: number, field: VariableBindableTextField) =>
          field === 'fontFamily'
            ? { id: 'id-range-font' }
            : ((globalThis as unknown as { figma: PluginAPI }).figma.mixed as symbol)
      )
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      mixed: Symbol('mixed'),
      getStyleById: vi.fn((styleId: string) => {
        if (styleId !== 'text-style-1') return null
        return {
          boundVariables: {
            fontSize: { id: 'id-style-size' }
          }
        }
      })
    } as unknown as PluginAPI

    const result = collectCandidateVariableIds([root])

    expect(result).toEqual(new Set(['id-range-font', 'id-style-size']))
  })

  it('handles sparse payload branches', () => {
    const root = createNode({
      id: 'sparse-root',
      visible: true,
      boundVariables: {
        none: null,
        literal: 'raw-string',
        hidden: { visible: false, id: 'id-hidden-ignored' },
        nested: { wrapper: { id: 'id-nested' } }
      },
      fills: [
        null,
        'invalid-fill',
        { type: 'SOLID', visible: true },
        {
          type: 'SOLID',
          visible: true,
          variableReferences: { color: { id: 'id-fill-ref-only' } }
        }
      ],
      strokes: [null, { type: 'SOLID', visible: true }],
      effects: [null, { type: 'DROP_SHADOW', visible: true }],
      fillStyleId: 'style-sparse'
    })
    const rootWithNullBound = createNode({
      id: 'null-bound-root',
      visible: true,
      boundVariables: null,
      fills: 'not-array',
      strokes: 'not-array',
      effects: 'not-array'
    })
    const rootWithNullStyle = createNode({
      id: 'null-style-root',
      visible: true,
      fillStyleId: 'style-null',
      boundVariables: { color: { id: 'id-undefined-name' } }
    })

    ;(globalThis as { figma?: PluginAPI }).figma = {
      getStyleById: vi.fn((styleId: string) => {
        if (styleId === 'style-sparse') {
          return {
            paints: [
              {
                type: 'SOLID',
                visible: true,
                variableReferences: { color: { id: 'id-style-ref' } }
              },
              {
                type: 'SOLID',
                visible: false,
                variableReferences: { color: { id: 'id-style-hidden-ref' } }
              }
            ]
          }
        }
        if (styleId === 'style-null') {
          return null
        }
        return { paints: 'not-array' }
      })
    } as unknown as PluginAPI

    const result = collectCandidateVariableIds([root, rootWithNullBound, rootWithNullStyle])

    expect(result).toEqual(
      new Set(['id-nested', 'id-fill-ref-only', 'id-style-ref', 'id-undefined-name'])
    )
  })
})
